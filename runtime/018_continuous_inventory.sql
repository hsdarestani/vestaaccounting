BEGIN;
ALTER TABLE source_inventory_balances ADD COLUMN IF NOT EXISTS last_movement_at timestamptz;
CREATE TABLE IF NOT EXISTS source_inventory_events (
 id text PRIMARY KEY,journal_id text NOT NULL REFERENCES journals(id),
 source_kind text NOT NULL,external_id text NOT NULL,parent_id text NOT NULL,
 event_kind text NOT NULL CHECK(event_kind IN('purchase','sale','return_in','damage','expired','lost','adjustment_in','stocktake_out')),
 event_at timestamptz NOT NULL,quantity_delta bigint NOT NULL CHECK(quantity_delta<>0),value_delta numeric NOT NULL CHECK(scale(value_delta)<=6),
 revenue_toman numeric CHECK(revenue_toman>=0 AND scale(revenue_toman)<=6),
 expected_version bigint NOT NULL,quantity_after bigint NOT NULL CHECK(quantity_after>=0),value_after numeric NOT NULL CHECK(value_after>=0 AND scale(value_after)<=6),
 residual_numerator text NOT NULL DEFAULT '0',residual_denominator text NOT NULL DEFAULT '1',related_sale_event text REFERENCES source_inventory_events(id),
 FOREIGN KEY(source_kind,external_id,parent_id) REFERENCES source_inventory_balances(source_kind,external_id,parent_id),
 UNIQUE(journal_id,source_kind,external_id,parent_id),CHECK((quantity_delta>0 AND value_delta>=0) OR (quantity_delta<0 AND value_delta<=0)),
 CHECK(quantity_after<>0 OR value_after=0)
);
CREATE INDEX IF NOT EXISTS source_inventory_event_identity ON source_inventory_events(source_kind,external_id,parent_id,event_at);
CREATE OR REPLACE FUNCTION source_inventory_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b source_inventory_balances%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'immutable inventory event'; END IF;
 IF NOT EXISTS(SELECT 1 FROM journals j WHERE j.id=NEW.journal_id AND j.status='posted') THEN RAISE EXCEPTION 'inventory journal not posted'; END IF;
 IF NEW.event_at<(SELECT effective_at_utc FROM accounting_cutover WHERE id=1) THEN RAISE EXCEPTION 'inventory before cutover'; END IF;
 SELECT * INTO b FROM source_inventory_balances WHERE source_kind=NEW.source_kind AND external_id=NEW.external_id AND parent_id=NEW.parent_id FOR UPDATE;
 IF NOT FOUND OR b.version<>NEW.expected_version OR b.quantity+NEW.quantity_delta<>NEW.quantity_after OR b.value_toman+NEW.value_delta<>NEW.value_after THEN RAISE EXCEPTION 'inventory stale'; END IF;
 IF b.last_movement_at IS NOT NULL AND NEW.event_at<b.last_movement_at THEN RAISE EXCEPTION 'backdated inventory movement'; END IF;
 UPDATE source_inventory_balances SET quantity=NEW.quantity_after,value_toman=NEW.value_after,version=version+1,last_movement_at=NEW.event_at WHERE source_kind=NEW.source_kind AND external_id=NEW.external_id AND parent_id=NEW.parent_id;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS source_inventory_event_guard ON source_inventory_events;
CREATE TRIGGER source_inventory_event_guard BEFORE INSERT OR UPDATE OR DELETE ON source_inventory_events FOR EACH ROW EXECUTE FUNCTION source_inventory_event_guard();
CREATE TABLE IF NOT EXISTS source_stock_adjustments (
 id text PRIMARY KEY,reference text NOT NULL UNIQUE,event_kind text NOT NULL CHECK(event_kind IN('return_in','damage','expired','lost','adjustment_in','stocktake_out')),
 source_kind text NOT NULL CHECK(source_kind IN('products','variations')),external_id text NOT NULL,parent_id text NOT NULL,event_at timestamptz NOT NULL,
 quantity bigint NOT NULL CHECK(quantity>0),value_toman numeric CHECK(value_toman>0 AND scale(value_toman)<=6),related_sale_event text REFERENCES source_inventory_events(id),
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 500),actor text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK((event_kind='adjustment_in')=(value_toman IS NOT NULL)),CHECK((event_kind='return_in')=(related_sale_event IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS source_stock_adjustment_journals(evidence_id text PRIMARY KEY REFERENCES source_stock_adjustments(id),journal_id text NOT NULL UNIQUE REFERENCES journals(id));
DROP TRIGGER IF EXISTS source_stock_adjustment_guard ON source_stock_adjustments;
CREATE TRIGGER source_stock_adjustment_guard BEFORE UPDATE OR DELETE ON source_stock_adjustments FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP TRIGGER IF EXISTS source_stock_adjustment_journal_guard ON source_stock_adjustment_journals;
CREATE TRIGGER source_stock_adjustment_journal_guard BEFORE UPDATE OR DELETE ON source_stock_adjustment_journals FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
CREATE TABLE IF NOT EXISTS woo_journal_queue (
 order_id text NOT NULL,revision_id bigint NOT NULL REFERENCES raw_revisions(id),status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','drafted','review','superseded')),
 reason text NOT NULL DEFAULT '',attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),checked_at timestamptz,PRIMARY KEY(order_id,revision_id)
);
CREATE INDEX IF NOT EXISTS woo_journal_queue_pending ON woo_journal_queue(status,next_attempt_at);
INSERT INTO migrations(version,applied) VALUES('018',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
