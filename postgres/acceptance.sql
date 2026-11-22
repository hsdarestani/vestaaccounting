-- Run only on a disposable database after 001_ledger.sql.
BEGIN;
INSERT INTO accounts(code,title,kind) VALUES('1010','Bank','asset'),('3010','Capital','equity'),('1200','Inventory','asset'),('2010','Payables','liability');
INSERT INTO periods(id,title,starts,ends) VALUES('00000000-0000-4000-8000-000000000001','Synthetic','2026-01-01','2026-12-31');
INSERT INTO journals(id,ref,posting_date,period_id,description,created_by) VALUES('00000000-0000-4000-8000-000000000002','test-opening','2026-01-01','00000000-0000-4000-8000-000000000001','Opening','tester');
INSERT INTO journal_lines(journal_id,account,debit,credit) VALUES('00000000-0000-4000-8000-000000000002','1010',10000,0),('00000000-0000-4000-8000-000000000002','3010',0,10000);
UPDATE journals SET status='approved',approved_by='reviewer' WHERE ref='test-opening';
UPDATE journals SET status='posted',posted_by='reviewer',posted_at=now() WHERE ref='test-opening';
DO $$ BEGIN
 IF (SELECT SUM(debit-credit) FROM trial_balance)<>0 OR (SELECT debit FROM trial_balance WHERE code='1010')<>10000 THEN RAISE EXCEPTION 'incorrect trial'; END IF;
 BEGIN UPDATE journals SET description='illegal' WHERE ref='test-opening'; RAISE EXCEPTION 'immutable test failed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'immutable journal' THEN RAISE; END IF; END;
 BEGIN INSERT INTO journal_lines(journal_id,account,debit,credit) VALUES('00000000-0000-4000-8000-000000000002','1010',1,0); RAISE EXCEPTION 'closed line test failed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'closed journal' THEN RAISE; END IF; END;
END $$;
INSERT INTO products(id,store,product_id,variation_id,name,category,quantity,value) VALUES('00000000-0000-4000-8000-000000000004','synthetic',1,11,'Variant','sample',0,0);
INSERT INTO documents(id,kind,external_ref,document_date,journal_id,evidence_ref) VALUES('00000000-0000-4000-8000-000000000005','opening','DEMO-STOCK','2026-01-01','00000000-0000-4000-8000-000000000002','synthetic');
INSERT INTO stock_movements(id,document_id,product_id,quantity_delta,value_delta,expected_version,quantity_after,value_after) VALUES('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004',10,1000,0,10,1000);
DO $$ BEGIN
 IF (SELECT quantity FROM products WHERE id='00000000-0000-4000-8000-000000000004')<>10 OR (SELECT value FROM products WHERE id='00000000-0000-4000-8000-000000000004')<>1000 THEN RAISE EXCEPTION 'stock application failed'; END IF;
 BEGIN INSERT INTO stock_movements(id,document_id,product_id,quantity_delta,value_delta,expected_version,quantity_after,value_after) VALUES('00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004',10,1000,0,20,2000); RAISE EXCEPTION 'stale stock test failed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'stale or invalid stock movement' THEN RAISE; END IF; END;
END $$;
INSERT INTO journals(id,ref,posting_date,period_id,description,created_by) VALUES('00000000-0000-4000-8000-000000000003','test-unbalanced','2026-01-02','00000000-0000-4000-8000-000000000001','Bad','tester');
INSERT INTO journal_lines(journal_id,account,debit,credit) VALUES('00000000-0000-4000-8000-000000000003','1010',100,0),('00000000-0000-4000-8000-000000000003','3010',0,99);
DO $$ BEGIN
 BEGIN UPDATE journals SET status='approved',approved_by='reviewer' WHERE ref='test-unbalanced'; RAISE EXCEPTION 'balance test failed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'unbalanced journal' THEN RAISE; END IF; END;
END $$;
UPDATE periods SET locked=true;
DO $$ BEGIN
 BEGIN UPDATE journals SET status='approved',approved_by='reviewer' WHERE ref='test-unbalanced'; RAISE EXCEPTION 'lock test failed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'closed or missing period' THEN RAISE; END IF; END;
END $$;
ROLLBACK;
SELECT 'PostgreSQL accounting acceptance passed' AS result;
