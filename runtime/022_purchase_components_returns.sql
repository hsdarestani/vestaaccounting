BEGIN;
INSERT INTO accounts(code,title,kind) VALUES('1120','مطالبات از تأمین‌کننده','asset'),('1130','مالیات خرید قابل بازیافت','asset'),('5060','اختلاف ارزش برگشت خرید','expense') ON CONFLICT DO NOTHING;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM (VALUES ('1120','مطالبات از تأمین‌کننده','asset'),('1130','مالیات خرید قابل بازیافت','asset'),('5060','اختلاف ارزش برگشت خرید','expense')) v(code,title,kind) LEFT JOIN accounts a USING(code) WHERE a.title IS DISTINCT FROM v.title OR a.kind IS DISTINCT FROM v.kind) THEN RAISE EXCEPTION 'purchase account conflict'; END IF; END $$;
DROP VIEW IF EXISTS bank_statement_candidates;
ALTER TABLE purchase_invoice_evidence ALTER COLUMN total_toman TYPE numeric;
ALTER TABLE supplier_payment_evidence ALTER COLUMN amount_toman TYPE numeric;
ALTER TABLE purchase_invoice_terms ALTER COLUMN initial_paid_toman TYPE numeric;
ALTER TABLE purchase_invoice_evidence DROP CONSTRAINT IF EXISTS purchase_total_exact_scale;
ALTER TABLE purchase_invoice_evidence ADD CONSTRAINT purchase_total_exact_scale CHECK(scale(total_toman)<=6);
ALTER TABLE supplier_payment_evidence DROP CONSTRAINT IF EXISTS supplier_payment_exact_scale;
ALTER TABLE supplier_payment_evidence ADD CONSTRAINT supplier_payment_exact_scale CHECK(scale(amount_toman)<=6);
ALTER TABLE purchase_invoice_terms DROP CONSTRAINT IF EXISTS purchase_terms_exact_scale;
ALTER TABLE purchase_invoice_terms ADD CONSTRAINT purchase_terms_exact_scale CHECK(scale(initial_paid_toman)<=6);
CREATE TABLE IF NOT EXISTS purchase_invoice_components(invoice_id text PRIMARY KEY REFERENCES purchase_invoice_evidence(id),components jsonb NOT NULL,allocation jsonb NOT NULL,recoverable_tax_toman numeric NOT NULL CHECK(recoverable_tax_toman>=0 AND scale(recoverable_tax_toman)<=6));
DROP TRIGGER IF EXISTS purchase_components_guard ON purchase_invoice_components;
CREATE TRIGGER purchase_components_guard BEFORE UPDATE OR DELETE ON purchase_invoice_components FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
ALTER TABLE source_inventory_events DROP CONSTRAINT IF EXISTS source_inventory_events_event_kind_check;
ALTER TABLE source_inventory_events ADD CONSTRAINT source_inventory_events_event_kind_check CHECK(event_kind IN('purchase','sale','return_in','purchase_return','damage','expired','lost','adjustment_in','stocktake_out'));
ALTER TABLE source_inventory_events ADD COLUMN IF NOT EXISTS related_purchase_event text REFERENCES source_inventory_events(id);
CREATE TABLE IF NOT EXISTS purchase_return_evidence(id text PRIMARY KEY,purchase_id text NOT NULL REFERENCES purchase_invoice_evidence(id),purchase_event_id text NOT NULL REFERENCES source_inventory_events(id),reference text NOT NULL UNIQUE CHECK(length(trim(reference)) BETWEEN 1 AND 120),returned_at timestamptz NOT NULL,quantity bigint NOT NULL CHECK(quantity>0),credit_toman numeric NOT NULL CHECK(credit_toman>0 AND scale(credit_toman)<=6),tax_reversal_toman numeric NOT NULL CHECK(tax_reversal_toman>=0 AND tax_reversal_toman<credit_toman AND scale(tax_reversal_toman)<=6),evidence_note text NOT NULL CHECK(length(trim(evidence_note)) BETWEEN 1 AND 500),actor text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS purchase_return_postings(evidence_id text PRIMARY KEY REFERENCES purchase_return_evidence(id),journal_id text NOT NULL UNIQUE REFERENCES journals(id),applied_payable_toman numeric NOT NULL CHECK(applied_payable_toman>=0 AND scale(applied_payable_toman)<=6),refund_receivable_toman numeric NOT NULL CHECK(refund_receivable_toman>=0 AND scale(refund_receivable_toman)<=6));
DROP TRIGGER IF EXISTS purchase_return_guard ON purchase_return_evidence;
CREATE TRIGGER purchase_return_guard BEFORE UPDATE OR DELETE ON purchase_return_evidence FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP TRIGGER IF EXISTS purchase_return_posting_guard ON purchase_return_postings;
CREATE TRIGGER purchase_return_posting_guard BEFORE UPDATE OR DELETE ON purchase_return_postings FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
CREATE VIEW bank_statement_candidates AS
 SELECT 'settlement:'||id||':'||bank_account AS source_key,'settlement' AS source_kind,bank_account AS account,bank_ref AS reference,settlement_date AS transaction_date,'credit'::text AS direction,net_toman AS amount_toman FROM gateway_settlement_evidence
 UNION ALL SELECT 'expense:'||id||':'||funding_account,'expense',funding_account,payment_ref,expense_date,'debit',amount_toman FROM operating_expense_evidence WHERE funding_account IN ('1010','1012','1013')
 UNION ALL SELECT 'supplier:'||id||':'||bank_account,'supplier_payment',bank_account,payment_ref,payment_date,'debit',amount_toman FROM supplier_payment_evidence WHERE bank_account IN ('1010','1012','1013')
 UNION ALL SELECT 'movement:'||e.id||':'||r.account,'bank_movement',r.account,r.reference,e.movement_date,CASE WHEN e.movement_kind='owner_withdrawal' OR (e.movement_kind='transfer' AND r.account=e.bank_account) THEN 'debit' ELSE 'credit' END,e.amount_toman FROM bank_movement_evidence e JOIN bank_movement_references r ON r.movement_id=e.id WHERE r.account IN ('1010','1012','1013')
 UNION ALL SELECT 'woo-collection:'||id||':'||account,'woo_collection',account,reference,collection_date,'credit',net_toman FROM woo_collection_evidence WHERE collection_kind='bank'
 UNION ALL SELECT 'woo-refund-payment:'||id||':'||account,'woo_refund_payment',account,reference,payment_date,'debit',amount_toman FROM woo_refund_payment_evidence WHERE statement_id IS NOT NULL;
INSERT INTO migrations(version,applied) VALUES('022',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
