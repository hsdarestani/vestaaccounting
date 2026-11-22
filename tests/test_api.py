import hashlib
import hmac
import json
import tempfile
import time
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from vesta.api import create_app
from vesta.auth import add_user

class ApiTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.secret='synthetic-key-0123456789-synthetic-key'; self.app=create_app(Path(self.temp.name)/'test.sqlite',True,self.secret)
        for role in ('owner','operator','auditor','accountant'):
            add_user(self.app.state.ledger,role,'synthetic-password-only',role)
        self.app.state.ledger.period('Synthetic','2026-01-01','2026-12-31','owner')
        self.client=TestClient(self.app,base_url='https://testserver')

    def tearDown(self): self.client.close(); self.temp.cleanup()

    def login(self,role):
        r=self.client.post('/api/login',json={'username':role,'password':'synthetic-password-only'}); self.assertEqual(r.status_code,200)
        self.token=r.json()['csrf']; self.assertIn('HttpOnly',r.headers['set-cookie']); self.assertIn('Secure',r.headers['set-cookie'])

    def draft(self): return {'source':'test','posting_date':'2026-01-01','description':'synthetic','lines':[{'account_code':'1010','debit':1200},{'account_code':'3010','credit':1200}]}
    def post(self,path,body=None): return self.client.post(path,json=body,headers={'X-CSRF-Token':self.token})

    def test_auth_and_permissions(self):
        self.assertEqual(self.client.get('/api/reports/trial').status_code,401)
        self.login('auditor'); self.assertEqual(self.client.get('/api/reports/trial').status_code,200); self.assertEqual(self.post('/api/journals',self.draft()).status_code,403)

    def test_operator_cannot_post_and_csrf_required(self):
        self.login('operator'); self.assertEqual(self.client.post('/api/journals',json=self.draft()).status_code,403)
        j=self.post('/api/journals',self.draft()).json()['id']; self.assertEqual(self.post(f'/api/journals/{j}/transition/approve').status_code,403)

    def test_exact_report_and_export(self):
        self.login('accountant'); j=self.post('/api/journals',self.draft()).json()['id']; self.assertEqual(self.post(f'/api/journals/{j}/transition/approve').status_code,200); self.assertEqual(self.post(f'/api/journals/{j}/transition/post').status_code,200)
        report=self.client.get('/api/reports/trial').json(); self.assertEqual(report['totals']['asset'],'1200'); self.assertFalse(report['profit_verified']); self.assertIn('1200',self.client.get('/api/reports/trial.csv').text)

    def test_signature_and_idempotency(self):
        body={'source':'test','kind':'payment_confirmed','event_key':'d1','payload':{'date':'2026-01-01','origin_date':'2026-01-01','business_key':'pay1','evidence_ref':'synthetic','facts':{'party_ref':'guest:1','gateway':'zibal','amount':1000}}}; raw=json.dumps(body).encode(); ts=str(int(time.time()))
        self.assertEqual(self.client.post('/api/evidence/ingest',content=raw).status_code,401)
        sig=hmac.new(self.secret.encode(),ts.encode()+b'.'+raw,hashlib.sha256).hexdigest(); headers={'X-Event-Timestamp':ts,'X-Event-Signature':sig}
        a=self.client.post('/api/evidence/ingest',content=raw,headers=headers); b=self.client.post('/api/evidence/ingest',content=raw,headers=headers)
        self.assertEqual(a.status_code,200); self.assertTrue(b.json()['duplicate']); self.assertEqual(a.json()['id'],b.json()['id'])

    def test_ui_served(self):
        self.assertIn('dir="rtl"',self.client.get('/').text); self.assertEqual(self.client.get('/assets/app.js').status_code,200)

if __name__=='__main__': unittest.main()
