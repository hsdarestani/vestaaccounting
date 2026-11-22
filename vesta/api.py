"""Persian-first evaluation API. No production activation pathway exists."""
import csv
import hmac
import io
import json
import os
import sqlite3
import threading
import time
from collections import defaultdict
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request, Response, Depends
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr
from .ledger import Ledger, RuleError
from . import auth, events

def report_json(report):
    # JSON clients may otherwise round ledger aggregates above 2^53-1.
    return report | {'trial':[r|{'debit':str(r['debit']),'credit':str(r['credit'])} for r in report['trial']],
        'totals':{k:str(v) for k,v in report['totals'].items()},'net_posted':str(report['net_posted'])}

class StrictModel(BaseModel):
    model_config=ConfigDict(extra='forbid')

class Login(StrictModel):
    username: str=Field(min_length=3,max_length=80)
    password: str=Field(min_length=1,max_length=256)

class Line(StrictModel):
    account_code: StrictStr
    debit: StrictInt=0
    credit: StrictInt=0
    detail: StrictStr=''
    memo: StrictStr=''

class Draft(StrictModel):
    source: str=Field(min_length=1,max_length=220)
    posting_date: str
    document_date: str|None=None
    description: str
    lines: list[Line]=Field(min_length=2,max_length=500)

class Period(StrictModel):
    title: str
    starts: str
    ends: str

class Account(StrictModel):
    code: str
    title: str
    kind: Literal['asset','liability','equity','revenue','expense']

class Lock(StrictModel):
    locked: bool
    reason: str

class Cutover(StrictModel):
    starts: str
    evidence: str

class Reversal(StrictModel):
    posting_date: str
    reason: str

class Product(StrictModel):
    store: str
    product_id: StrictInt
    variation_id: StrictInt=0
    title: str
    sku: str=''

class Opening(StrictModel):
    source: str
    product: StrictInt
    quantity: StrictInt
    evidence: str
    cost_total: StrictInt|None=None

class EventPayload(StrictModel):
    date: str
    origin_date: str
    business_key: str
    evidence_ref: str
    facts: dict

class Envelope(StrictModel):
    source: str
    event_key: str
    kind: str
    payload: EventPayload

def create_app(db_path=None,secure_cookie=None,webhook_secret=None):
    ledger=Ledger(db_path or os.environ.get('VESTA_DB','data/evaluation.sqlite'))
    ledger.initialize()
    secret=webhook_secret if webhook_secret is not None else os.environ.get('VESTA_EVENT_SECRET','')
    secure=secure_cookie if secure_cookie is not None else os.environ.get('VESTA_LOCAL_HTTP')!='1'
    app=FastAPI(title='Vesta Accounting | Evaluation',version='0.1.0',docs_url=None,redoc_url=None,openapi_url=None)
    app.state.ledger=ledger
    attempts=defaultdict(list); attempts_lock=threading.Lock()
    static=Path(__file__).with_name('static')

    @app.middleware('http')
    async def headers(request,call_next):
        result=await call_next(request)
        result.headers['Cache-Control']='no-store'
        result.headers['X-Content-Type-Options']='nosniff'
        result.headers['X-Frame-Options']='DENY'
        result.headers['Referrer-Policy']='no-referrer'
        result.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        return result

    @app.exception_handler(RuleError)
    async def rule_error(request,exc):
        return JSONResponse(status_code=422,content={'detail':str(exc)})

    @app.exception_handler(sqlite3.IntegrityError)
    async def constraint_error(request,exc):
        return JSONResponse(status_code=409,content={'detail':'Financial integrity constraint rejected operation.'})

    def user(request:Request):
        u=auth.session(ledger,request.cookies.get('vesta_session'))
        if u is None: raise HTTPException(401,'Authentication required')
        return u

    def allowed(*roles):
        def require(request:Request,u=Depends(user)):
            if u['role'] not in roles: raise HTTPException(403,'Insufficient permission')
            if request.method not in ('GET','HEAD') and not hmac.compare_digest(u['csrf'],request.headers.get('X-CSRF-Token','')):
                raise HTTPException(403,'Invalid CSRF token')
            return u
        return require

    read_finance=allowed('owner','accountant','operator','auditor')
    draft_finance=allowed('owner','accountant','operator')
    approve_finance=allowed('owner','accountant')
    owner=allowed('owner')
    everyone=allowed('owner','accountant','operator','auditor','admin')

    @app.get('/')
    def home(): return FileResponse(static/'index.html')

    @app.get('/assets/{name}')
    def assets(name:Literal['app.js','style.css']): return FileResponse(static/name)

    @app.get('/health')
    def health():
        with ledger.read() as c: c.execute('SELECT 1').fetchone()
        return {'status':'ok','mode':'evaluation','live_integration':False}

    @app.post('/api/login')
    def login(body:Login,request:Request,response:Response):
        ip=request.client.host if request.client else 'unknown'; now=time.monotonic()
        with attempts_lock:
            # Bound the number of active buckets; upstream rate limiting remains required.
            if len(attempts)>10_000:
                for key in list(attempts):
                    if not any(x>now-60 for x in attempts[key]): del attempts[key]
                if len(attempts)>10_000: raise HTTPException(429,'Try later')
            attempts[ip]=[x for x in attempts[ip] if x>now-60]
            if len(attempts[ip])>=6: raise HTTPException(429,'Try later')
            attempts[ip].append(now)
        result=auth.login(ledger,body.username,body.password)
        if not result: raise HTTPException(401,'Invalid credentials')
        response.set_cookie('vesta_session',result.pop('token'),httponly=True,secure=secure,samesite='strict',max_age=28800,path='/')
        return result

    @app.get('/api/me')
    def me(u=Depends(everyone)): return u

    @app.post('/api/logout')
    def logout(request:Request,response:Response,u=Depends(everyone)):
        auth.logout(ledger,request.cookies.get('vesta_session'))
        response.delete_cookie('vesta_session',path='/')
        return {'ok':True}

    @app.get('/api/accounts')
    def accounts(u=Depends(read_finance)):
        with ledger.read() as c: return [dict(r) for r in c.execute('SELECT * FROM account ORDER BY code')]

    @app.post('/api/accounts')
    def create_account(body:Account,u=Depends(approve_finance)):
        ledger.add_account(**body.model_dump(),actor=u['username']); return {'ok':True}

    @app.get('/api/periods')
    def periods(u=Depends(read_finance)):
        with ledger.read() as c: return [dict(r) for r in c.execute('SELECT * FROM fiscal_period ORDER BY starts')]

    @app.post('/api/periods')
    def create_period(body:Period,u=Depends(owner)):
        return {'id':ledger.period(body.title,body.starts,body.ends,u['username'])}

    @app.post('/api/periods/{identifier}/lock')
    def set_period_lock(identifier:int,body:Lock,u=Depends(owner)):
        ledger.set_lock(identifier,body.locked,u['username'],body.reason); return {'ok':True}

    @app.post('/api/cutover')
    def cutover(body:Cutover,u=Depends(owner)):
        ledger.set_cutover(body.starts,u['username'],body.evidence); return {'ok':True}

    @app.get('/api/journals')
    def journals(offset:int=0,limit:int=100,u=Depends(read_finance)):
        with ledger.read() as c: return [dict(r) for r in c.execute('SELECT * FROM journal ORDER BY id DESC LIMIT ? OFFSET ?',(min(max(limit,1),250),max(0,offset)))]

    @app.post('/api/journals')
    def draft(body:Draft,u=Depends(draft_finance)):
        data=body.model_dump(); data['source']='manual:'+data['source']
        return {'id':ledger.draft(**data,actor=u['username'])}

    @app.get('/api/journals/{identifier}')
    def journal(identifier:int,u=Depends(read_finance)): return ledger.journal(identifier)

    @app.post('/api/journals/{identifier}/transition/{action}')
    def transition(identifier:int,action:Literal['approve','post'],u=Depends(approve_finance)):
        ledger.transition(identifier,action,u['username']); return {'ok':True}

    @app.post('/api/journals/{identifier}/reverse')
    def reverse(identifier:int,body:Reversal,u=Depends(approve_finance)):
        return {'id':ledger.reverse(identifier,body.posting_date,u['username'],body.reason)}

    @app.get('/api/reports/trial')
    def trial(through:str|None=None,starts:str|None=None,u=Depends(read_finance)): return report_json(ledger.report(through,starts))

    @app.get('/api/reports/ledger/{code}')
    def account_ledger(code:str,through:str|None=None,starts:str|None=None,detail:str|None=None,limit:int=100,offset:int=0,u=Depends(read_finance)):
        result=ledger.account_ledger(code,starts,through,detail,limit,offset)
        return result|{k:str(result[k]) for k in ('opening','debit','credit','closing')}|{'rows':[r|{'debit':str(r['debit']),'credit':str(r['credit'])} for r in result['rows']]}

    @app.get('/api/reports/trial.csv')
    def trial_csv(through:str|None=None,starts:str|None=None,u=Depends(read_finance)):
        output=io.StringIO(); w=csv.writer(output); w.writerow(['code','account','debit_toman','credit_toman'])
        for row in ledger.trial(through,starts): w.writerow([row['code'],row['title'],row['debit'],row['credit']])
        return Response('\ufeff'+output.getvalue(),media_type='text/csv; charset=utf-8',headers={'Content-Disposition':'attachment; filename=trial-balance.csv'})

    @app.get('/api/products')
    def products(offset:int=0,limit:int=100,u=Depends(read_finance)):
        with ledger.read() as c:
            return [dict(r) for r in c.execute('''SELECT p.*,COALESCE(SUM(m.quantity),0) opening_quantity,
            CASE WHEN COUNT(m.id)=0 OR SUM(CASE WHEN m.cost_total IS NULL THEN 1 ELSE 0 END)>0 THEN NULL ELSE SUM(m.cost_total) END opening_cost
            FROM product p LEFT JOIN stock_movement m ON p.id=m.product GROUP BY p.id ORDER BY p.id LIMIT ? OFFSET ?''',(min(max(limit,1),250),max(0,offset)))]

    @app.post('/api/products')
    def product(body:Product,u=Depends(draft_finance)):
        return {'id':ledger.upsert_product(**body.model_dump(),actor=u['username'])}

    @app.post('/api/inventory/opening-reference')
    def opening(body:Opening,u=Depends(approve_finance)):
        return {'id':ledger.opening_quantity(**body.model_dump(),actor=u['username'])}

    @app.post('/api/evidence/ingest')
    async def ingest(request:Request):
        raw=await request.body()
        if len(raw)>64_000: raise HTTPException(413,'Evidence too large')
        if not events.verify_signature(secret,request.headers.get('X-Event-Timestamp'),request.headers.get('X-Event-Signature'),raw):
            raise HTTPException(401,'Invalid evidence signature')
        try: data=Envelope.model_validate_json(raw)
        except ValueError: raise HTTPException(422,'Invalid evidence envelope')
        return events.ingest(ledger,data.source,data.event_key,data.kind,data.payload.model_dump())

    @app.get('/api/events')
    def event_list(offset:int=0,limit:int=100,u=Depends(read_finance)):
        with ledger.read() as c: return [dict(r) for r in c.execute('''SELECT e.id,e.source,e.event_key,e.kind,e.received_at,
        CASE WHEN EXISTS(SELECT 1 FROM event_conflict x WHERE x.event_id=e.id) THEN 'conflict' ELSE e.status END status,
        CASE WHEN EXISTS(SELECT 1 FROM event_conflict x WHERE x.event_id=e.id) THEN 'Conflicting delivery evidence' ELSE e.reason END reason,e.journal_id
        FROM external_event e ORDER BY e.id DESC LIMIT ? OFFSET ?''',(min(max(limit,1),250),max(0,offset)))]

    @app.post('/api/events/{identifier}/draft')
    def event_draft(identifier:int,u=Depends(draft_finance)): return events.process(ledger,identifier,u['username'])

    @app.get('/api/audit')
    def audit(offset:int=0,limit:int=100,u=Depends(approve_finance)):
        with ledger.read() as c: return [dict(r) for r in c.execute('SELECT * FROM audit ORDER BY id DESC LIMIT ? OFFSET ?',(min(max(limit,1),250),max(0,offset)))]

    @app.get('/api/dashboard')
    def dashboard(u=Depends(read_finance)):
        with ledger.read() as c:
            result={'journals':{r['status']:r['n'] for r in c.execute('SELECT status,COUNT(*) n FROM journal GROUP BY status')},'events':{r['status']:r['n'] for r in c.execute('SELECT status,COUNT(*) n FROM external_event GROUP BY status')},'products':c.execute('SELECT COUNT(*) FROM product').fetchone()[0],'cutover':None}
            result['events']['conflict']=c.execute("SELECT COUNT(*) FROM external_event e WHERE e.status='conflict' OR EXISTS(SELECT 1 FROM event_conflict x WHERE x.event_id=e.id)").fetchone()[0]
            row=c.execute("SELECT value FROM setting WHERE key='cutover'").fetchone()
            if row: result['cutover']=row['value']
        result['financial']=report_json(ledger.report()); return result

    return app
