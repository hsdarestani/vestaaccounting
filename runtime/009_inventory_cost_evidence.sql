BEGIN;
CREATE TABLE IF NOT EXISTS inventory_cost_evidence (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 stock_revision bigint NOT NULL REFERENCES opening_stock_reconciliation(id),
 cost_revision bigint NOT NULL CHECK(cost_revision>=0),
 source_kind text NOT NULL,
 external_id text NOT NULL,
 parent_id text NOT NULL,
 opening_value_toman numeric(24,0) NOT NULL CHECK(opening_value_toman>=0),
 evidence jsonb NOT NULL,
 result jsonb NOT NULL,
 fingerprint text NOT NULL UNIQUE,
 actor text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_cost_evidence_item ON inventory_cost_evidence(source_kind,external_id,parent_id,id DESC);
DROP TRIGGER IF EXISTS inventory_cost_evidence_guard ON inventory_cost_evidence;
CREATE TRIGGER inventory_cost_evidence_guard BEFORE UPDATE OR DELETE ON inventory_cost_evidence
 FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
INSERT INTO migrations(version,applied) VALUES('009',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
