BEGIN;
CREATE TABLE IF NOT EXISTS bank_statement_rows (
 id text PRIMARY KEY,
 account text NOT NULL REFERENCES accounts(code) CHECK(account IN ('1010','1012','1013')),
 transaction_date date NOT NULL,
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 120),
 direction text NOT NULL CHECK(direction IN ('credit','debit')),
 amount_toman numeric(16,2) NOT NULL CHECK(amount_toman>0 AND amount_toman<=1000000000000),
 currency text NOT NULL CHECK(currency IN ('IRT','IRR')),
 source_amount text NOT NULL,
 description text NOT NULL DEFAULT '' CHECK(length(description)<=500),
 actor text NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account,reference)
);
CREATE INDEX IF NOT EXISTS bank_statement_date_idx ON bank_statement_rows(account,transaction_date);
CREATE TABLE IF NOT EXISTS bank_statement_links (
 statement_id text PRIMARY KEY REFERENCES bank_statement_rows(id),
 source_key text NOT NULL UNIQUE,
 method text NOT NULL CHECK(method IN ('exact_reference','owner_confirmed')),
 note text NOT NULL CHECK(length(note)<=500),
 actor text NOT NULL,
 at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS bank_statement_guard ON bank_statement_rows;
CREATE TRIGGER bank_statement_guard BEFORE UPDATE OR DELETE ON bank_statement_rows FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP TRIGGER IF EXISTS bank_statement_link_guard ON bank_statement_links;
CREATE TRIGGER bank_statement_link_guard BEFORE UPDATE OR DELETE ON bank_statement_links FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP VIEW IF EXISTS bank_statement_candidates;
CREATE VIEW bank_statement_candidates AS
 SELECT 'settlement:'||id||':'||bank_account AS source_key,'settlement' AS source_kind,bank_account AS account,bank_ref AS reference,settlement_date AS transaction_date,'credit'::text AS direction,net_toman AS amount_toman FROM gateway_settlement_evidence
 UNION ALL SELECT 'expense:'||id||':'||funding_account,'expense',funding_account,payment_ref,expense_date,'debit',amount_toman FROM operating_expense_evidence WHERE funding_account IN ('1010','1012','1013')
 UNION ALL SELECT 'supplier:'||id||':'||bank_account,'supplier_payment',bank_account,payment_ref,payment_date,'debit',amount_toman FROM supplier_payment_evidence WHERE bank_account IN ('1010','1012','1013')
 UNION ALL SELECT 'movement:'||e.id||':'||r.account,'bank_movement',r.account,r.reference,e.movement_date,
 CASE WHEN e.movement_kind='owner_withdrawal' OR (e.movement_kind='transfer' AND r.account=e.bank_account) THEN 'debit' ELSE 'credit' END,e.amount_toman
 FROM bank_movement_evidence e JOIN bank_movement_references r ON r.movement_id=e.id WHERE r.account IN ('1010','1012','1013');
INSERT INTO migrations(version,applied) VALUES('016',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
