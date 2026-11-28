BEGIN;
-- Numeric without typmod: validation rejects excess precision rather than rounding it.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='lines' AND column_name='debit' AND data_type='bigint') THEN ALTER TABLE lines ALTER COLUMN debit TYPE numeric USING debit::numeric, ALTER COLUMN credit TYPE numeric USING credit::numeric; END IF; END $$;
ALTER TABLE lines DROP CONSTRAINT IF EXISTS source_lines_precision;
ALTER TABLE lines ADD CONSTRAINT source_lines_precision CHECK(scale(debit)<=6 AND scale(credit)<=6);
CREATE TABLE IF NOT EXISTS source_posting_state (
 id integer PRIMARY KEY CHECK(id=1),active boolean NOT NULL DEFAULT false,
 opening_journal text UNIQUE REFERENCES journals(id),snapshot_digest text,approved_by text,approval_note text,activated_at timestamptz,
 CHECK((NOT active AND activated_at IS NULL) OR (active AND opening_journal IS NOT NULL AND snapshot_digest IS NOT NULL AND approved_by IS NOT NULL AND approval_note IS NOT NULL AND activated_at IS NOT NULL))
);
INSERT INTO source_posting_state(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS source_posting_authorizations (
 journal_id text NOT NULL REFERENCES journals(id),stage text NOT NULL CHECK(stage IN('approved','posted')),actor text NOT NULL,
 note text NOT NULL CHECK(length(trim(note)) BETWEEN 1 AND 500),at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(journal_id,stage)
);
CREATE TABLE IF NOT EXISTS source_opening_snapshots (
 journal_id text PRIMARY KEY REFERENCES journals(id),digest text NOT NULL UNIQUE,content jsonb NOT NULL,actor text NOT NULL,at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS source_inventory_balances (
 source_kind text NOT NULL CHECK(source_kind IN('products','variations')),external_id text NOT NULL,parent_id text NOT NULL,
 quantity bigint NOT NULL CHECK(quantity>=0),value_toman numeric NOT NULL CHECK(value_toman>=0 AND scale(value_toman)<=6),
 version bigint NOT NULL DEFAULT 0 CHECK(version>=0),opening_journal text NOT NULL REFERENCES journals(id),
 PRIMARY KEY(source_kind,external_id,parent_id),CHECK((source_kind='products' AND parent_id='') OR (source_kind='variations' AND parent_id~'^[1-9][0-9]*$'))
);
DROP TRIGGER IF EXISTS source_opening_snapshot_guard ON source_opening_snapshots;
CREATE TRIGGER source_opening_snapshot_guard BEFORE UPDATE OR DELETE ON source_opening_snapshots FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP TRIGGER IF EXISTS source_posting_authorization_guard ON source_posting_authorizations;
CREATE TRIGGER source_posting_authorization_guard BEFORE UPDATE OR DELETE ON source_posting_authorizations FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
CREATE OR REPLACE FUNCTION source_journal_posting_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE control source_posting_state%ROWTYPE; expected_actor text;
BEGIN
 IF NEW.status=OLD.status THEN RETURN NEW; END IF;
 SELECT * INTO control FROM source_posting_state WHERE id=1 FOR SHARE;
 IF NOT FOUND OR (NOT control.active AND control.opening_journal IS DISTINCT FROM NEW.id) THEN RAISE EXCEPTION 'source posting gate closed'; END IF;
 IF control.active AND NOT EXISTS(SELECT 1 FROM journals WHERE id=control.opening_journal AND status='posted') THEN RAISE EXCEPTION 'source opening required'; END IF;
 expected_actor:=CASE WHEN NEW.status='approved' THEN NEW.approved_by WHEN NEW.status='posted' THEN NEW.posted_by END;
 IF expected_actor IS NULL OR NOT EXISTS(SELECT 1 FROM source_posting_authorizations WHERE journal_id=NEW.id AND stage=NEW.status AND actor=expected_actor) THEN RAISE EXCEPTION 'source posting authorization missing'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS source_journal_gate ON journals;
CREATE TRIGGER source_journal_gate BEFORE UPDATE ON journals FOR EACH ROW EXECUTE FUNCTION source_journal_posting_gate();
CREATE OR REPLACE FUNCTION source_opening_revision_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM source_posting_state WHERE id=1 AND active) THEN RAISE EXCEPTION 'source opening immutable after approval'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS source_opening_bridge_gate ON opening_balance_bridge_evidence;
CREATE TRIGGER source_opening_bridge_gate BEFORE INSERT ON opening_balance_bridge_evidence FOR EACH ROW EXECUTE FUNCTION source_opening_revision_gate();
DROP TRIGGER IF EXISTS source_opening_stock_gate ON opening_stock_reconciliation;
CREATE TRIGGER source_opening_stock_gate BEFORE INSERT ON opening_stock_reconciliation FOR EACH ROW EXECUTE FUNCTION source_opening_revision_gate();
DROP TRIGGER IF EXISTS source_opening_cost_gate ON purchase_cost_revisions;
CREATE TRIGGER source_opening_cost_gate BEFORE INSERT ON purchase_cost_revisions FOR EACH ROW EXECUTE FUNCTION source_opening_revision_gate();
INSERT INTO migrations(version,applied) VALUES('017',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
