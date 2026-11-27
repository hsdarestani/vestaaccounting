BEGIN;
CREATE TABLE IF NOT EXISTS gateway_settlement_evidence (
 id text PRIMARY KEY,
 gateway_account text NOT NULL REFERENCES accounts(code) CHECK(gateway_account IN ('1310','1320','1330','1340','1350','1390')),
 bank_account text NOT NULL REFERENCES accounts(code) CHECK(bank_account IN ('1010','1012','1013')),
 gateway_ref text NOT NULL CHECK(length(trim(gateway_ref)) BETWEEN 1 AND 120),
 bank_ref text NOT NULL CHECK(length(trim(bank_ref)) BETWEEN 1 AND 120),
 settlement_date date NOT NULL,
 gross_toman numeric(16,2) NOT NULL CHECK(gross_toman>0 AND gross_toman<=1000000000000),
 net_toman numeric(16,2) NOT NULL CHECK(net_toman>0),
 fee_toman numeric(16,2) NOT NULL CHECK(fee_toman>=0),
 ledger_basis text NOT NULL CHECK(ledger_basis IN ('gross_unexpensed','net_already_expensed','unknown')),
 evidence_note text NOT NULL CHECK(length(trim(evidence_note)) BETWEEN 1 AND 500),
 actor text NOT NULL,
 at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(gateway_account,gateway_ref), UNIQUE(bank_account,bank_ref),
 CHECK(gross_toman=net_toman+fee_toman)
);
CREATE INDEX IF NOT EXISTS gateway_settlement_evidence_date ON gateway_settlement_evidence(settlement_date,id);
CREATE TABLE IF NOT EXISTS gateway_settlement_drafts (
 evidence_id text PRIMARY KEY REFERENCES gateway_settlement_evidence(id),
 journal_id text NOT NULL UNIQUE REFERENCES journals(id)
);
DROP TRIGGER IF EXISTS gateway_settlement_evidence_guard ON gateway_settlement_evidence;
CREATE TRIGGER gateway_settlement_evidence_guard BEFORE UPDATE OR DELETE ON gateway_settlement_evidence
 FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP TRIGGER IF EXISTS gateway_settlement_drafts_guard ON gateway_settlement_drafts;
CREATE TRIGGER gateway_settlement_drafts_guard BEFORE UPDATE OR DELETE ON gateway_settlement_drafts
 FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
INSERT INTO migrations(version,applied) VALUES('005',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
