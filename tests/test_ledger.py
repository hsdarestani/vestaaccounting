import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from vesta.ledger import Ledger, RuleError, line, normalize_amount
from vesta import events

DATE='2026-01-15'

class LedgerTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.ledger=Ledger(Path(self.temp.name)/'test.sqlite'); self.ledger.initialize()
        self.period=self.ledger.period('Synthetic period','2026-01-01','2026-12-31','owner')

    def tearDown(self): self.temp.cleanup()

    def draft(self,source='sample',amount=123_456):
        return self.ledger.draft(source=source,posting_date=DATE,description='synthetic',lines=[line('1010',debit=amount),line('3010',credit=amount)],actor='operator')

    def post(self,j):
        self.ledger.transition(j,'approve','accountant'); self.ledger.transition(j,'post','accountant')

    def balance(self,code):
        r=next(r for r in self.ledger.trial() if r['code']==code); return r['debit'],r['credit']

    def test_draft_excluded_then_exact_post(self):
        j=self.draft(); self.assertEqual(self.balance('1010'),(0,0)); self.post(j)
        self.assertEqual(self.balance('1010'),(123456,0)); self.assertEqual(self.balance('3010'),(0,123456))
        self.assertEqual(sum(r['debit']-r['credit'] for r in self.ledger.trial()),0)

    def test_unbalanced_rejected(self):
        with self.assertRaises(RuleError): self.ledger.draft(source='bad',posting_date=DATE,description='bad',lines=[line('1010',debit=100),line('3010',credit=99)],actor='operator')

    def test_float_and_bool_rejected(self):
        for v in (100.0,True,-5):
            with self.assertRaises(RuleError): self.draft('bad',v)

    def test_source_idempotency_and_conflict(self):
        self.assertEqual(self.draft(),self.draft())
        with self.assertRaises(RuleError): self.draft(amount=123457)

    def test_concurrent_duplicates(self):
        with ThreadPoolExecutor(max_workers=8) as pool: ids=list(pool.map(lambda _:self.draft(),range(24)))
        self.assertEqual(len(set(ids)),1)
        with self.ledger.read() as c: self.assertEqual(c.execute('SELECT COUNT(*) FROM journal').fetchone()[0],1)

    def test_direct_posted_changes_rejected(self):
        j=self.draft(); self.post(j)
        for sql in ('UPDATE journal SET description="changed" WHERE id=?','DELETE FROM journal WHERE id=?','UPDATE journal_line SET debit=1 WHERE journal_id=?','DELETE FROM journal_line WHERE journal_id=?'):
            with self.assertRaises(sqlite3.IntegrityError):
                with self.ledger.transaction() as c: c.execute(sql,(j,))

    def test_reversal_preserves_both_journals(self):
        j=self.draft(); self.post(j); reverse=self.ledger.reverse(j,DATE,'accountant','synthetic correction'); self.post(reverse)
        self.assertEqual(self.balance('1010'),(123456,123456)); self.assertEqual(self.ledger.journal(j)['status'],'posted'); self.assertEqual(self.ledger.journal(reverse)['reverses'],j)

    def test_cannot_post_without_approval(self):
        with self.assertRaises(RuleError): self.ledger.transition(self.draft(),'post','accountant')

    def test_locked_period_blocks_approved_post(self):
        j=self.draft(); self.ledger.transition(j,'approve','accountant'); self.ledger.set_lock(self.period,True,'owner','review')
        with self.assertRaises(sqlite3.IntegrityError): self.ledger.transition(j,'post','accountant')
        with self.assertRaises(RuleError): self.draft('new')
        self.assertEqual(self.ledger.journal(j)['status'],'approved')

    def test_overlapping_period_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError): self.ledger.period('bad','2026-12-30','2027-02-01','owner')

    def test_unknown_account_atomic_rollback(self):
        with self.assertRaises(sqlite3.IntegrityError): self.ledger.draft(source='bad',posting_date=DATE,description='bad',lines=[line('1010',debit=100),line('missing',credit=100)],actor='operator')
        with self.ledger.read() as c: self.assertEqual(c.execute('SELECT COUNT(*) FROM journal').fetchone()[0],0)

    def test_rial_toman_explicit_exact(self):
        self.assertEqual(normalize_amount('1234560','IRR'),{'original':'1234560','unit':'IRR','divisor':10,'toman':123456})
        self.assertEqual(normalize_amount('123456','IRT')['toman'],123456)
        for value,unit in [('1234561','IRR'),('12.1','IRT'),(1.0,'IRT'),('NaN','IRR'),('100','USD')]:
            with self.assertRaises(RuleError): normalize_amount(value,unit)

    def test_variation_identity_rename_unknown_cost(self):
        a=self.ledger.upsert_product('test',1,21,'قرمز','','operator'); b=self.ledger.upsert_product('test',1,22,'قرمز','','operator')
        self.assertNotEqual(a,b); self.assertEqual(a,self.ledger.upsert_product('test',1,21,'نام جدید','','operator'))
        id1=self.ledger.opening_quantity('open:a',a,10,'accountant','stock count',None)
        self.assertEqual(id1,self.ledger.opening_quantity('open:a',a,10,'accountant','stock count',None))
        with self.ledger.read() as c: self.assertIsNone(c.execute('SELECT cost_total FROM stock_movement WHERE id=?',(id1,)).fetchone()[0])
        self.assertEqual(self.balance('1200'),(0,0))

    def test_event_no_cutoff_then_retry(self):
        payload=self.payload('sale-1',{'party_ref':'guest:1','subtotal':1000,'discount':200,'shipping':150,'tax':50,'total':1000})
        e=events.ingest(self.ledger,'test','delivery','sale_fulfilled',payload)
        self.assertEqual(events.process(self.ledger,e['id'],'operator')['status'],'review')
        self.ledger.set_cutover('2026-01-01','owner','synthetic approval')
        r=events.process(self.ledger,e['id'],'operator'); self.assertEqual(r['status'],'drafted'); self.post(r['journal_id'])
        self.assertEqual(self.balance('1100'),(1000,0)); self.assertEqual(self.balance('4010'),(0,1000)); self.assertEqual(self.balance('4030'),(200,0)); self.assertEqual(self.balance('4020'),(0,150)); self.assertEqual(self.balance('2100'),(0,50))

    def payload(self,key,facts,origin=DATE): return {'business_key':key,'date':DATE,'origin_date':origin,'evidence_ref':'synthetic-evidence','facts':facts}

    def test_delivery_dedup_and_business_dedup(self):
        self.ledger.set_cutover('2026-01-01','owner','synthetic approval')
        p=self.payload('pay-1',{'party_ref':'guest:1','gateway':'zibal','amount':123456})
        e=events.ingest(self.ledger,'test','d1','payment_confirmed',p)
        self.assertTrue(events.ingest(self.ledger,'test','d1','payment_confirmed',p)['duplicate'])
        r=events.process(self.ledger,e['id'],'operator'); j=r['journal_id']
        e2=events.ingest(self.ledger,'test','d2','payment_confirmed',p)
        self.assertEqual(events.process(self.ledger,e2['id'],'operator')['journal_id'],j)
        self.assertEqual(events.process(self.ledger,e2['id'],'operator')['status'],'duplicate')
        self.post(j); self.assertEqual(self.balance('1310'),(123456,0)); self.assertEqual(self.balance('2020'),(0,123456)); self.assertEqual(self.balance('4010'),(0,0))

    def test_event_conflicting_delivery_blocks_approval(self):
        self.ledger.set_cutover('2026-01-01','owner','synthetic approval')
        p=self.payload('pay-1',{'party_ref':'guest:1','gateway':'zibal','amount':100})
        e=events.ingest(self.ledger,'test','d1','payment_confirmed',p); j=events.process(self.ledger,e['id'],'operator')['journal_id']
        p['facts']['amount']=101
        self.assertEqual(events.ingest(self.ledger,'test','d1','payment_confirmed',p)['status'],'conflict')
        with self.assertRaises(RuleError): self.ledger.transition(j,'approve','accountant')

    def test_pre_cutover_never_drafted(self):
        self.ledger.set_cutover('2026-01-01','owner','synthetic approval')
        p=self.payload('old',{'party_ref':'guest:1','gateway':'zibal','amount':100},'2025-12-31')
        e=events.ingest(self.ledger,'test','d1','payment_confirmed',p); self.assertEqual(events.process(self.ledger,e['id'],'operator')['status'],'historical')
        with self.ledger.read() as c: self.assertEqual(c.execute('SELECT COUNT(*) FROM journal').fetchone()[0],0)

    def test_conflicting_business_reference_blocks_prior_draft(self):
        self.ledger.set_cutover('2026-01-01','owner','synthetic approval')
        p=self.payload('pay-1',{'party_ref':'guest:1','gateway':'zibal','amount':100})
        e=events.ingest(self.ledger,'test','d1','payment_confirmed',p); j=events.process(self.ledger,e['id'],'operator')['journal_id']
        p['facts']['amount']=101; e2=events.ingest(self.ledger,'test','d2','payment_confirmed',p)
        self.assertEqual(events.process(self.ledger,e2['id'],'operator')['status'],'conflict')
        with self.assertRaises(RuleError): self.ledger.transition(j,'approve','accountant')

    def test_configurable_account_and_ledger(self):
        self.ledger.add_account('1011','Synthetic bank','asset','accountant')
        j=self.ledger.draft(source='bank',posting_date=DATE,description='opening bank',lines=[line('1011',debit=1200,detail='bank-a'),line('3010',credit=1200)],actor='operator'); self.post(j)
        summary=self.ledger.account_ledger('1011',starts='2026-01-01',through='2026-12-31',detail='bank-a')
        self.assertEqual((summary['debit'],summary['credit'],summary['closing']),(1200,0,1200)); self.assertEqual(summary['rows'][0]['journal_id'],j)
        self.assertEqual(self.ledger.account_ledger('1011',starts='2026-02-01')['opening'],1200)

    def test_gateway_settlement_fee_and_net(self):
        entries=events.rules('gateway_settlement',{'gross':100000,'net':97000,'fee':3000,'gateway':'snappPay','bank_ref':'bank-1','batch_ref':'batch-1'})
        self.assertEqual(entries,[line('1320',credit=100000),line('1010',debit=97000),line('5020',debit=3000)])
        with self.assertRaises(RuleError): events.rules('gateway_settlement',{'gross':100000,'net':97000,'fee':2000,'gateway':'snappPay','bank_ref':'bank-1','batch_ref':'batch-1'})

    def test_purchase_supplier_payment_expense(self):
        self.assertEqual(events.rules('purchase_invoice',{'party_ref':'s1','cost':500,'receipt_ref':'receipt'}),[line('1200',debit=500),line('2010',credit=500,detail='s1')])
        self.assertEqual(events.rules('supplier_payment',{'party_ref':'s1','amount':100}),[line('2010',debit=100,detail='s1'),line('1010',credit=100)])
        self.assertEqual(events.rules('expense_paid',{'amount':50,'expense_account':'5030'}),[line('5030',debit=50),line('1010',credit=50)])

    def test_pending_or_failed_has_no_rule(self):
        for kind in ['order_pending','payment_failed','order_canceled']:
            with self.assertRaises(RuleError): events.rules(kind,{})

    def test_restart_retains_durable_event(self):
        e=events.ingest(self.ledger,'test','d1','payment_confirmed',self.payload('pay',{'party_ref':'guest:1','gateway':'zibal','amount':100}))
        fresh=Ledger(self.ledger.path); fresh.initialize(); fresh.set_cutover('2026-01-01','owner','synthetic approval')
        self.assertEqual(events.process(fresh,e['id'],'operator')['status'],'drafted')

if __name__=='__main__': unittest.main()
