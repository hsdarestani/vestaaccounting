BEGIN;
CREATE TABLE IF NOT EXISTS woo_collection_evidence (
 id text PRIMARY KEY,order_id text NOT NULL,order_revision bigint NOT NULL REFERENCES raw_revisions(id),collection_kind text NOT NULL CHECK(collection_kind IN('bank','gateway')),
 account text NOT NULL REFERENCES accounts(code),reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 120),collection_date date NOT NULL,
 gross_toman numeric NOT NULL CHECK(gross_toman>0 AND gross_toman<=1000000000000 AND scale(gross_toman)<=6),net_toman numeric NOT NULL CHECK(net_toman>0 AND scale(net_toman)<=6),
 commission_toman numeric NOT NULL CHECK(commission_toman>=0 AND scale(commission_toman)<=6),commission_tax_toman numeric NOT NULL CHECK(commission_tax_toman>=0 AND scale(commission_tax_toman)<=6),
 statement_id text UNIQUE REFERENCES bank_statement_rows(id),source_currency text NOT NULL CHECK(source_currency IN('IRT','IRR')),source_amounts jsonb NOT NULL,
 evidence_note text NOT NULL CHECK(length(trim(evidence_note)) BETWEEN 1 AND 500),actor text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account,reference),CHECK(gross_toman=net_toman+commission_toman+commission_tax_toman),
 CHECK((collection_kind='bank' AND account IN('1010','1012','1013') AND statement_id IS NOT NULL AND commission_toman=0 AND commission_tax_toman=0) OR (collection_kind='gateway' AND account IN('1310','1320','1330','1340','1350','1390') AND statement_id IS NULL))
);
CREATE INDEX IF NOT EXISTS woo_collection_order_idx ON woo_collection_evidence(order_id);
CREATE INDEX IF NOT EXISTS opening_cost_text_identity ON opening_input_costs_v1((external_id::text),source_kind);
CREATE TABLE IF NOT EXISTS woo_collection_drafts(evidence_id text PRIMARY KEY REFERENCES woo_collection_evidence(id),journal_id text NOT NULL UNIQUE REFERENCES journals(id));
DROP TRIGGER IF EXISTS woo_collection_guard ON woo_collection_evidence;
CREATE TRIGGER woo_collection_guard BEFORE UPDATE OR DELETE ON woo_collection_evidence FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP TRIGGER IF EXISTS woo_collection_draft_guard ON woo_collection_drafts;
CREATE TRIGGER woo_collection_draft_guard BEFORE UPDATE OR DELETE ON woo_collection_drafts FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP VIEW IF EXISTS bank_statement_candidates;
ALTER TABLE bank_statement_rows ALTER COLUMN amount_toman TYPE numeric;
ALTER TABLE bank_statement_rows DROP CONSTRAINT IF EXISTS bank_statement_exact_scale;
ALTER TABLE bank_statement_rows ADD CONSTRAINT bank_statement_exact_scale CHECK(scale(amount_toman)<=6);
CREATE VIEW bank_statement_candidates AS
 SELECT 'settlement:'||id||':'||bank_account AS source_key,'settlement' AS source_kind,bank_account AS account,bank_ref AS reference,settlement_date AS transaction_date,'credit'::text AS direction,net_toman AS amount_toman FROM gateway_settlement_evidence
 UNION ALL SELECT 'expense:'||id||':'||funding_account,'expense',funding_account,payment_ref,expense_date,'debit',amount_toman FROM operating_expense_evidence WHERE funding_account IN ('1010','1012','1013')
 UNION ALL SELECT 'supplier:'||id||':'||bank_account,'supplier_payment',bank_account,payment_ref,payment_date,'debit',amount_toman FROM supplier_payment_evidence WHERE bank_account IN ('1010','1012','1013')
 UNION ALL SELECT 'movement:'||e.id||':'||r.account,'bank_movement',r.account,r.reference,e.movement_date,CASE WHEN e.movement_kind='owner_withdrawal' OR (e.movement_kind='transfer' AND r.account=e.bank_account) THEN 'debit' ELSE 'credit' END,e.amount_toman FROM bank_movement_evidence e JOIN bank_movement_references r ON r.movement_id=e.id WHERE r.account IN ('1010','1012','1013')
 UNION ALL SELECT 'woo-collection:'||id||':'||account,'woo_collection',account,reference,collection_date,'credit',net_toman FROM woo_collection_evidence WHERE collection_kind='bank';
INSERT INTO migrations(version,applied) VALUES('020',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
