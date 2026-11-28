BEGIN;
INSERT INTO accounts(code,title,kind) VALUES('2040','استردادهای پرداختنی مشتری','liability') ON CONFLICT DO NOTHING;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM accounts WHERE code='2040' AND title='استردادهای پرداختنی مشتری' AND kind='liability') THEN RAISE EXCEPTION 'refund liability account conflict'; END IF; END $$;
CREATE TABLE IF NOT EXISTS woo_refund_paid_allocation (
 order_id text NOT NULL,refund_id text NOT NULL,paid_toman numeric NOT NULL CHECK(paid_toman>0 AND paid_toman<=1000000000000 AND scale(paid_toman)<=6),
 PRIMARY KEY(order_id,refund_id),FOREIGN KEY(order_id,refund_id) REFERENCES woo_refund_review_drafts(order_id,refund_id)
);
CREATE TABLE IF NOT EXISTS woo_refund_payment_evidence (
 id text PRIMARY KEY,order_id text NOT NULL,refund_id text NOT NULL,account text NOT NULL REFERENCES accounts(code),reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 120),
 payment_date date NOT NULL,amount_toman numeric NOT NULL CHECK(amount_toman>0 AND amount_toman<=1000000000000 AND scale(amount_toman)<=6),source_currency text NOT NULL CHECK(source_currency IN('IRT','IRR')),source_amount text NOT NULL,
 statement_id text UNIQUE REFERENCES bank_statement_rows(id),evidence_note text NOT NULL CHECK(length(trim(evidence_note)) BETWEEN 1 AND 500),actor text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account,reference),FOREIGN KEY(order_id,refund_id) REFERENCES woo_refund_paid_allocation(order_id,refund_id),CHECK((account IN('1010','1012','1013') AND statement_id IS NOT NULL) OR (account IN('1310','1320','1330','1340','1350','1390') AND statement_id IS NULL))
);
CREATE TABLE IF NOT EXISTS woo_refund_payment_drafts(evidence_id text PRIMARY KEY REFERENCES woo_refund_payment_evidence(id),journal_id text NOT NULL UNIQUE REFERENCES journals(id));
DROP TRIGGER IF EXISTS woo_refund_paid_guard ON woo_refund_paid_allocation;
CREATE TRIGGER woo_refund_paid_guard BEFORE UPDATE OR DELETE ON woo_refund_paid_allocation FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP TRIGGER IF EXISTS woo_refund_payment_guard ON woo_refund_payment_evidence;
CREATE TRIGGER woo_refund_payment_guard BEFORE UPDATE OR DELETE ON woo_refund_payment_evidence FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP TRIGGER IF EXISTS woo_refund_payment_draft_guard ON woo_refund_payment_drafts;
CREATE TRIGGER woo_refund_payment_draft_guard BEFORE UPDATE OR DELETE ON woo_refund_payment_drafts FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP VIEW IF EXISTS bank_statement_candidates;
CREATE VIEW bank_statement_candidates AS
 SELECT 'settlement:'||id||':'||bank_account AS source_key,'settlement' AS source_kind,bank_account AS account,bank_ref AS reference,settlement_date AS transaction_date,'credit'::text AS direction,net_toman AS amount_toman FROM gateway_settlement_evidence
 UNION ALL SELECT 'expense:'||id||':'||funding_account,'expense',funding_account,payment_ref,expense_date,'debit',amount_toman FROM operating_expense_evidence WHERE funding_account IN ('1010','1012','1013')
 UNION ALL SELECT 'supplier:'||id||':'||bank_account,'supplier_payment',bank_account,payment_ref,payment_date,'debit',amount_toman FROM supplier_payment_evidence WHERE bank_account IN ('1010','1012','1013')
 UNION ALL SELECT 'movement:'||e.id||':'||r.account,'bank_movement',r.account,r.reference,e.movement_date,CASE WHEN e.movement_kind='owner_withdrawal' OR (e.movement_kind='transfer' AND r.account=e.bank_account) THEN 'debit' ELSE 'credit' END,e.amount_toman FROM bank_movement_evidence e JOIN bank_movement_references r ON r.movement_id=e.id WHERE r.account IN ('1010','1012','1013')
 UNION ALL SELECT 'woo-collection:'||id||':'||account,'woo_collection',account,reference,collection_date,'credit',net_toman FROM woo_collection_evidence WHERE collection_kind='bank'
 UNION ALL SELECT 'woo-refund-payment:'||id||':'||account,'woo_refund_payment',account,reference,payment_date,'debit',amount_toman FROM woo_refund_payment_evidence WHERE statement_id IS NOT NULL;
INSERT INTO migrations(version,applied) VALUES('021',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
