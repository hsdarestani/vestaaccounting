BEGIN;
CREATE TABLE IF NOT EXISTS opening_balance_bridge_evidence (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 evidence_date date NOT NULL,
 line_key text NOT NULL,
 observed_at timestamptz NOT NULL,
 increases_toman numeric(18,2) NOT NULL CHECK(increases_toman>=0),
 decreases_toman numeric(18,2) NOT NULL CHECK(decreases_toman>=0),
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 500),
 actor text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(evidence_date,line_key) REFERENCES opening_input_balances_v1(evidence_date,line_key)
);
CREATE INDEX IF NOT EXISTS opening_balance_bridge_latest ON opening_balance_bridge_evidence(evidence_date,line_key,id DESC);
DROP TRIGGER IF EXISTS opening_balance_bridge_guard ON opening_balance_bridge_evidence;
CREATE TRIGGER opening_balance_bridge_guard BEFORE UPDATE OR DELETE ON opening_balance_bridge_evidence
 FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
INSERT INTO migrations(version,applied) VALUES('006',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
