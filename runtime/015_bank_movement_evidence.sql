BEGIN;
INSERT INTO accounts(code,title,kind) VALUES
 ('3020','آورده مالک','equity'),('3030','برداشت مالک','equity'),('2030','وام‌های دریافتی','liability') ON CONFLICT DO NOTHING;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES('3020','آورده مالک','equity'),('3030','برداشت مالک','equity'),('2030','وام‌های دریافتی','liability')) v(code,title,kind)
 LEFT JOIN accounts a USING(code) WHERE a.title IS DISTINCT FROM v.title OR a.kind IS DISTINCT FROM v.kind) THEN
  RAISE EXCEPTION 'bank movement account mapping conflicts with existing chart';
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS bank_movement_evidence (
 id text PRIMARY KEY,
 movement_kind text NOT NULL CHECK(movement_kind IN('transfer','customer_receipt','customer_deposit','owner_contribution','owner_withdrawal','loan_receipt')),
 movement_date date NOT NULL,
 bank_account text NOT NULL REFERENCES accounts(code) CHECK(bank_account IN('1010','1011','1012','1013')),
 other_bank_account text REFERENCES accounts(code) CHECK(other_bank_account IN('1010','1011','1012','1013')),
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 120),
 other_reference text CHECK(length(trim(other_reference)) BETWEEN 1 AND 120),
 party_id text REFERENCES parties(id),
 amount_toman numeric(16,2) NOT NULL CHECK(amount_toman>0 AND amount_toman<=1000000000000),
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 500),
 actor text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK((movement_kind='transfer' AND other_bank_account IS NOT NULL AND other_bank_account<>bank_account AND other_reference IS NOT NULL)
   OR (movement_kind<>'transfer' AND other_bank_account IS NULL AND other_reference IS NULL)),
 CHECK((movement_kind IN('customer_receipt','customer_deposit') AND party_id IS NOT NULL)
   OR (movement_kind NOT IN('customer_receipt','customer_deposit') AND party_id IS NULL))
);
CREATE TABLE IF NOT EXISTS bank_movement_references (
 account text NOT NULL REFERENCES accounts(code),
 reference text NOT NULL,
 movement_id text NOT NULL REFERENCES bank_movement_evidence(id),
 PRIMARY KEY(account,reference),UNIQUE(movement_id,account)
);
CREATE TABLE IF NOT EXISTS bank_movement_drafts (
 evidence_id text PRIMARY KEY REFERENCES bank_movement_evidence(id),
 journal_id text NOT NULL UNIQUE REFERENCES journals(id)
);
CREATE INDEX IF NOT EXISTS bank_movement_date_idx ON bank_movement_evidence(movement_date);
DROP TRIGGER IF EXISTS bank_movement_evidence_guard ON bank_movement_evidence;
CREATE TRIGGER bank_movement_evidence_guard BEFORE UPDATE OR DELETE ON bank_movement_evidence FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP TRIGGER IF EXISTS bank_movement_references_guard ON bank_movement_references;
CREATE TRIGGER bank_movement_references_guard BEFORE UPDATE OR DELETE ON bank_movement_references FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP TRIGGER IF EXISTS bank_movement_drafts_guard ON bank_movement_drafts;
CREATE TRIGGER bank_movement_drafts_guard BEFORE UPDATE OR DELETE ON bank_movement_drafts FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
INSERT INTO migrations(version,applied) VALUES('015',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
