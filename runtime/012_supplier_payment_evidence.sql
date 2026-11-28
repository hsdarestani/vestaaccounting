BEGIN;
CREATE TABLE IF NOT EXISTS supplier_payment_evidence (
 id text PRIMARY KEY,
 purchase_id text NOT NULL REFERENCES purchase_invoice_evidence(id),
 payment_date date NOT NULL,
 bank_account text NOT NULL REFERENCES accounts(code) CHECK(bank_account IN ('1010','1011','1012','1013')),
 payment_ref text NOT NULL CHECK(length(trim(payment_ref)) BETWEEN 1 AND 120),
 amount_toman numeric(16,2) NOT NULL CHECK(amount_toman>0 AND amount_toman<=1000000000000),
 evidence_note text NOT NULL CHECK(length(trim(evidence_note)) BETWEEN 1 AND 500),
 actor text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(bank_account,payment_ref)
);
CREATE INDEX IF NOT EXISTS supplier_payment_purchase_idx ON supplier_payment_evidence(purchase_id);
CREATE TABLE IF NOT EXISTS supplier_payment_drafts (
 evidence_id text PRIMARY KEY REFERENCES supplier_payment_evidence(id),
 journal_id text NOT NULL UNIQUE REFERENCES journals(id)
);
DROP TRIGGER IF EXISTS supplier_payment_evidence_guard ON supplier_payment_evidence;
CREATE TRIGGER supplier_payment_evidence_guard BEFORE UPDATE OR DELETE ON supplier_payment_evidence FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP TRIGGER IF EXISTS supplier_payment_drafts_guard ON supplier_payment_drafts;
CREATE TRIGGER supplier_payment_drafts_guard BEFORE UPDATE OR DELETE ON supplier_payment_drafts FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
INSERT INTO migrations(version,applied) VALUES('012',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
