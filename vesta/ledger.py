"""Transactional integer-Toman ledger for isolated evaluation databases.

No external services are contacted by this module. Posting rules require
professional approval before any production use.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

MAX_MONEY = 10**15
ACCOUNTS = (
    ('1010','صندوق و بانک','asset'), ('1100','حساب‌های دریافتنی','asset'),
    ('1200','موجودی کالا','asset'), ('1310','درگاه زیبال','asset'),
    ('1320','درگاه اسنپ‌پی','asset'), ('1330','درگاه تروپی','asset'),
    ('1340','درگاه دیجی‌پی','asset'), ('1390','مطالبات درگاه دیگر','asset'),
    ('2010','حساب‌های پرداختنی','liability'), ('2020','پیش‌دریافت مشتری','liability'),
    ('2100','مالیات پرداختنی','liability'), ('3010','سرمایه و مانده افتتاحیه','equity'),
    ('4010','فروش کالا','revenue'), ('4020','درآمد ارسال','revenue'),
    ('4030','تخفیفات فروش','revenue'), ('4040','برگشت از فروش','revenue'),
    ('5010','بهای تمام‌شده','expense'), ('5020','کارمزد درگاه','expense'),
    ('5030','هزینه ارسال','expense'), ('5090','سایر هزینه‌ها','expense'),
)
GATEWAYS = {'zibal':'1310','snappPay':'1320','torobPay':'1330','digiPay':'1340'}

class RuleError(ValueError):
    pass

def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)

def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()

def day(value):
    if not isinstance(value, str):
        raise RuleError('date must be an ISO date')
    try:
        result = date.fromisoformat(value)
    except ValueError as exc:
        raise RuleError('invalid ISO date') from exc
    if result.isoformat() != value:
        raise RuleError('date must be YYYY-MM-DD')
    return value

def amt(value, name='amount', allow_zero=False):
    if type(value) is not int or value < (0 if allow_zero else 1) or value > MAX_MONEY:
        raise RuleError(f'{name}: expected bounded nonnegative integer Toman')
    return value

def normalize_amount(value, unit):
    """Lossless conversion. Fractional Toman is an exception, never rounded."""
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise RuleError('amount must be integer or decimal string')
    if unit not in ('IRR','IRT'):
        raise RuleError('explicit IRR or IRT required')
    try:
        d = Decimal(str(value))
        if not d.is_finite() or d < 0 or d > MAX_MONEY * 10:
            raise RuleError('invalid external amount')
        factor = 10 if unit == 'IRR' else 1
        normalized = d / factor
        if normalized != normalized.to_integral_value():
            raise RuleError('fractional Toman requires review')
        return {'original': str(value), 'unit':unit, 'divisor':factor, 'toman':amt(int(normalized), allow_zero=True)}
    except InvalidOperation as exc:
        raise RuleError('invalid external amount') from exc

def line(code, *, debit=0, credit=0, detail='', memo=''):
    return {'account_code':code,'debit':debit,'credit':credit,'detail':detail,'memo':memo}

def need_text(value, name, limit=500):
    if not isinstance(value,str) or not value.strip() or len(value)>limit:
        raise RuleError(f'invalid {name}')
    return value.strip()

def validate_lines(lines):
    if not isinstance(lines,list) or not 2 <= len(lines) <= 500:
        raise RuleError('two to 500 lines required')
    result=[]
    for l in lines:
        code=need_text(l.get('account_code'),'account',40)
        d=amt(l.get('debit',0),'debit',True); c=amt(l.get('credit',0),'credit',True)
        if bool(d)==bool(c):
            raise RuleError('each line must have debit OR credit')
        detail=l.get('detail',''); memo=l.get('memo','')
        if not isinstance(detail,str) or len(detail)>200 or not isinstance(memo,str) or len(memo)>500:
            raise RuleError('invalid line detail or memo')
        result.append(line(code,debit=d,credit=c,detail=detail,memo=memo))
    if sum(l['debit']-l['credit'] for l in result):
        raise RuleError('journal must balance')
    return result

class Ledger:
    def __init__(self, path):
        self.path=str(path)

    def connect(self):
        con=sqlite3.connect(self.path,timeout=15,isolation_level=None)
        con.row_factory=sqlite3.Row
        con.execute('PRAGMA foreign_keys=ON')
        con.execute('PRAGMA busy_timeout=15000')
        return con

    def initialize(self):
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as c:
            c.execute('PRAGMA journal_mode=WAL')
            c.executescript(Path(__file__).with_name('schema.sql').read_text())
            c.executemany('INSERT OR IGNORE INTO account(code,title,kind) VALUES (?,?,?)',ACCOUNTS)

    @contextmanager
    def transaction(self):
        c=self.connect()
        try:
            c.execute('BEGIN IMMEDIATE')
            yield c
            c.commit()
        except BaseException:
            c.rollback(); raise
        finally:
            c.close()

    @contextmanager
    def read(self):
        c=self.connect()
        try:
            c.execute('BEGIN')
            yield c
        finally:
            c.close()

    @staticmethod
    def audit(c,actor,action,ref,evidence=''):
        c.execute('INSERT INTO audit(at,actor,action,object_ref,evidence) VALUES (?,?,?,?,?)',(stamp(),actor,action,str(ref),evidence))

    def period(self,title,starts,ends,actor):
        day(starts); day(ends)
        with self.transaction() as c:
            p=c.execute('INSERT INTO fiscal_period(title,starts,ends) VALUES (?,?,?)',(need_text(title,'period'),starts,ends)).lastrowid
            self.audit(c,actor,'period.create',p)
            return p

    def set_lock(self,period_id,locked,actor,reason):
        with self.transaction() as c:
            if c.execute('UPDATE fiscal_period SET locked=? WHERE id=?',(int(locked),period_id)).rowcount != 1:
                raise RuleError('period not found')
            self.audit(c,actor,'period.lock' if locked else 'period.reopen',period_id,need_text(reason,'reason'))

    def set_cutover(self,starts,actor,evidence):
        day(starts)
        with self.transaction() as c:
            old=c.execute("SELECT value FROM setting WHERE key='cutover'").fetchone()
            if old and old['value']!=starts:
                raise RuleError('cutover already set; controlled migration required')
            c.execute("INSERT OR IGNORE INTO setting VALUES ('cutover',?)",(starts,))
            self.audit(c,actor,'cutover.record',starts,need_text(evidence,'evidence'))

    def add_account(self,code,title,kind,actor):
        code=need_text(code,'account code',40)
        if not code.isascii() or not code.replace('-','').isdigit() or kind not in ('asset','liability','equity','revenue','expense'):
            raise RuleError('invalid account code or kind')
        with self.transaction() as c:
            c.execute('INSERT INTO account(code,title,kind) VALUES (?,?,?)',(code,need_text(title,'account title'),kind))
            self.audit(c,actor,'account.create',code,kind)

    def draft(self, *, source, posting_date, description, lines, actor, document_date=None, rule_version='manual-v1', reverses=None):
        with self.transaction() as c:
            return self._draft(c,source,posting_date,description,lines,actor,document_date,rule_version,reverses)

    def _draft(self,c,source,posting_date,description,lines,actor,document_date=None,rule_version='manual-v1',reverses=None):
        source=need_text(source,'source',250); day(posting_date); document_date=day(document_date or posting_date)
        description=need_text(description,'description'); normalized=validate_lines(lines)
        fingerprint=digest({'date':posting_date,'document_date':document_date,'description':description,'lines':normalized,'rule':rule_version,'reverses':reverses})
        old=c.execute('SELECT id,fingerprint FROM journal WHERE source=?',(source,)).fetchone()
        if old:
            if old['fingerprint']!=fingerprint:
                raise RuleError('source conflict: same business reference, different financial facts')
            return old['id']
        period=c.execute('SELECT id,locked FROM fiscal_period WHERE ? BETWEEN starts AND ends',(posting_date,)).fetchone()
        if not period or period['locked']:
            raise RuleError('posting date outside open fiscal periods')
        j=c.execute('INSERT INTO journal(source,fingerprint,posting_date,document_date,description,period_id,actor,rule_version,reverses) VALUES (?,?,?,?,?,?,?,?,?)',(source,fingerprint,posting_date,document_date,description,period['id'],actor,rule_version,reverses)).lastrowid
        c.executemany('INSERT INTO journal_line(journal_id,account_code,detail,memo,debit,credit) VALUES (?,?,?,?,?,?)',[(j,l['account_code'],l['detail'],l['memo'],l['debit'],l['credit']) for l in normalized])
        self.audit(c,actor,'journal.draft',j,source)
        return j

    def transition(self,j,action,actor):
        with self.transaction() as c:
            row=c.execute('SELECT * FROM journal WHERE id=?',(j,)).fetchone()
            if not row:
                raise RuleError('journal not found')
            if c.execute('''SELECT 1 FROM external_event e WHERE e.journal_id=? AND (e.status='conflict' OR EXISTS(SELECT 1 FROM event_conflict x WHERE x.event_id=e.id))''',(j,)).fetchone():
                raise RuleError('conflicting evidence blocks approval and posting')
            if action=='approve' and row['status']=='draft':
                c.execute("UPDATE journal SET status='approved',approver=? WHERE id=?",(actor,j))
            elif action=='post' and row['status']=='approved':
                c.execute("UPDATE journal SET status='posted',posted_by=?,posted_at=? WHERE id=?",(actor,stamp(),j))
            else:
                raise RuleError('invalid journal transition')
            self.audit(c,actor,'journal.'+action,j)

    def reverse(self,j,posting_date,actor,reason):
        with self.transaction() as c:
            original=c.execute("SELECT * FROM journal WHERE id=? AND status='posted'",(j,)).fetchone()
            if not original:
                raise RuleError('only posted journal can be reversed')
            lines=[line(r['account_code'],debit=r['credit'],credit=r['debit'],detail=r['detail'],memo=r['memo']) for r in c.execute('SELECT * FROM journal_line WHERE journal_id=? ORDER BY id',(j,))]
            return self._draft(c,f'reversal:{j}',posting_date,'برگشت سند — '+need_text(reason,'reason'),lines,actor,rule_version='reversal-v1',reverses=j)

    def journal(self,j):
        with self.read() as c:
            row=c.execute('SELECT * FROM journal WHERE id=?',(j,)).fetchone()
            if not row:
                raise RuleError('journal not found')
            return dict(row)|{'lines':[dict(r) for r in c.execute('SELECT * FROM journal_line WHERE journal_id=? ORDER BY id',(j,))]}

    def trial(self,through=None,starts=None):
        through=day(through or '9999-12-31'); starts=day(starts or '0001-01-01')
        with self.read() as c:
            return [dict(r) for r in c.execute('''SELECT a.code,a.title,a.kind,
            COALESCE(SUM(CASE WHEN j.id IS NOT NULL THEN l.debit ELSE 0 END),0) debit,
            COALESCE(SUM(CASE WHEN j.id IS NOT NULL THEN l.credit ELSE 0 END),0) credit
            FROM account a LEFT JOIN journal_line l ON a.code=l.account_code
            LEFT JOIN journal j ON l.journal_id=j.id AND j.status='posted' AND j.posting_date BETWEEN ? AND ?
            GROUP BY a.code,a.title,a.kind ORDER BY a.code''',(starts,through))]

    def report(self,through=None,starts=None):
        rows=self.trial(through,starts)
        totals={k:sum((r['debit']-r['credit']) if k in ('asset','expense') else (r['credit']-r['debit']) for r in rows if r['kind']==k) for k in ('asset','liability','equity','revenue','expense')}
        return {'trial':rows,'totals':totals,'net_posted':totals['revenue']-totals['expense'],'profit_verified':False,'note':'Ledger-only evaluation: opening balances, inventory and policy approval not verified.'}

    def account_ledger(self,code,starts=None,through=None,detail=None,limit=100,offset=0):
        starts=day(starts or '0001-01-01'); through=day(through or '9999-12-31')
        if starts>through: raise RuleError('invalid report period')
        limit=max(1,min(limit,250)); offset=max(0,offset)
        with self.read() as c:
            account=c.execute('SELECT * FROM account WHERE code=?',(code,)).fetchone()
            if not account: raise RuleError('unknown ledger account')
            clause="j.status='posted' AND l.account_code=? AND (? IS NULL OR l.detail=?)"
            params=(code,detail,detail)
            q=' FROM journal_line l JOIN journal j ON j.id=l.journal_id WHERE '+clause
            opening=c.execute('SELECT COALESCE(SUM(l.debit-l.credit),0)'+q+' AND j.posting_date<?',params+(starts,)).fetchone()[0]
            totals=c.execute('SELECT COALESCE(SUM(l.debit),0) debit, COALESCE(SUM(l.credit),0) credit,COUNT(*) n'+q+' AND j.posting_date BETWEEN ? AND ?',params+(starts,through)).fetchone()
            rows=[dict(r) for r in c.execute('SELECT j.id journal_id,j.posting_date,j.source,j.description,l.id line_id,l.detail,l.debit,l.credit,l.memo'+q+' AND j.posting_date BETWEEN ? AND ? ORDER BY j.posting_date,j.id,l.id LIMIT ? OFFSET ?',params+(starts,through,limit,offset))]
            return {'account':dict(account),'opening':opening,'debit':totals['debit'],'credit':totals['credit'],'closing':opening+totals['debit']-totals['credit'],'count':totals['n'],'rows':rows}

    def upsert_product(self,store,product_id,variation_id,title,sku,actor):
        if type(product_id) is not int or type(variation_id) is not int or product_id<=0 or variation_id<0:
            raise RuleError('invalid product identity')
        with self.transaction() as c:
            row=c.execute('INSERT INTO product(store,product_id,variation_id,title,sku) VALUES (?,?,?,?,?) ON CONFLICT(store,product_id,variation_id) DO UPDATE SET title=excluded.title,sku=excluded.sku RETURNING id',(need_text(store,'store',60),product_id,variation_id,need_text(title,'title'),sku)).fetchone()
            self.audit(c,actor,'product.snapshot',row['id'])
            return row['id']

    def opening_quantity(self,source,product,quantity,actor,evidence,cost_total=None):
        if type(quantity) is not int or not 0<quantity<=10**9:
            raise RuleError('positive opening quantity required')
        if cost_total is not None:
            amt(cost_total,allow_zero=True)
        with self.transaction() as c:
            values=(product,quantity,need_text(evidence,'evidence'),cost_total)
            old=c.execute('SELECT * FROM stock_movement WHERE source=?',(source,)).fetchone()
            if old:
                if tuple(old[k] for k in ('product','quantity','evidence','cost_total'))!=values:
                    raise RuleError('opening stock source conflict')
                return old['id']
            if c.execute('SELECT 1 FROM stock_movement WHERE product=?',(product,)).fetchone():
                raise RuleError('opening movement already exists for product')
            ident=c.execute('INSERT INTO stock_movement(source,product,quantity,evidence,at,cost_total) VALUES (?,?,?,?,?,?)',(need_text(source,'source'),product,quantity,values[2],stamp(),cost_total)).lastrowid
            self.audit(c,actor,'stock.opening_reference',ident)
            return ident
