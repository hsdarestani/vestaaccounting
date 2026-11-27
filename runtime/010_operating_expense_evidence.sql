BEGIN;
CREATE TABLE IF NOT EXISTS operating_expense_evidence (
 id text PRIMARY KEY,
 expense_date date NOT NULL,
 expense_account text NOT NULL REFERENCES accounts(code) CHECK(expense_account IN ('5030','5040','5090')),
 funding_account text NOT NULL REFERENCES accounts(code) CHECK(funding_account IN ('1010','1011','1012','1013','2010')),
 supplier_id text REFERENCES parties(id),
 invoice_ref text NOT NULL UNIQUE CHECK(length(trim(invoice_ref)) BETWEEN 1 AND 120),
 payment_ref text CHECK(length(trim(payment_ref)) BETWEEN 1 AND 120),
 amount_toman numeric(16,2) NOT NULL CHECK(amount_toman>0 AND amount_toman<=1000000000000),
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 500),
 actor text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK((funding_account='2010' AND supplier_id IS NOT NULL AND payment_ref IS NULL)
 OR (funding_account<>'2010' AND payment_ref IS NOT NULL)),
 UNIQUE(funding_account,payment_ref)
);
CREATE TABLE IF NOT EXISTS operating_expense_drafts (
 evidence_id text PRIMARY KEY REFERENCES operating_expense_evidence(id),
 journal_id text NOT NULL UNIQUE REFERENCES journals(id)
);
DROP TRIGGER IF EXISTS operating_expense_evidence_guard ON operating_expense_evidence;
CREATE TRIGGER operating_expense_evidence_guard BEFORE UPDATE OR DELETE ON operating_expense_evidence FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP TRIGGER IF EXISTS operating_expense_drafts_guard ON operating_expense_drafts;
CREATE TRIGGER operating_expense_drafts_guard BEFORE UPDATE OR DELETE ON operating_expense_drafts FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
INSERT INTO migrations(version,applied) VALUES('010',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
