BEGIN;
CREATE TABLE IF NOT EXISTS opening_stock_reconciliation (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 capture_id integer NOT NULL,
 source_kind text NOT NULL,
 external_id text NOT NULL,
 parent_id text NOT NULL,
 observed_quantity bigint NOT NULL CHECK(observed_quantity BETWEEN 0 AND 1000000000000),
 received_quantity bigint NOT NULL CHECK(received_quantity BETWEEN 0 AND 1000000000000),
 issued_quantity bigint NOT NULL CHECK(issued_quantity BETWEEN 0 AND 1000000000000),
 observed_at timestamptz NOT NULL,
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 500),
 actor text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(capture_id,source_kind,external_id,parent_id) REFERENCES opening_capture_items(capture_id,source_kind,external_id,parent_id)
);
CREATE INDEX IF NOT EXISTS opening_stock_reconciliation_latest ON opening_stock_reconciliation(capture_id,source_kind,external_id,parent_id,id DESC);
DROP TRIGGER IF EXISTS opening_stock_reconciliation_guard ON opening_stock_reconciliation;
CREATE TRIGGER opening_stock_reconciliation_guard BEFORE UPDATE OR DELETE ON opening_stock_reconciliation
FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
CREATE OR REPLACE VIEW opening_stock_reconciled_review AS
SELECT i.source_kind,i.external_id,i.parent_id,i.name,i.stock_quantity AS captured_quantity,
 r.id AS reconciliation_revision,r.observed_quantity,r.received_quantity,r.issued_quantity,
 r.observed_at,r.reference,
 r.observed_quantity-r.received_quantity+r.issued_quantity AS opening_quantity,
 c.unit_cost_toman,c.cost_status,c.priority_review,
 CASE WHEN r.id IS NULL THEN 'evidence_required'
  WHEN r.observed_quantity-r.received_quantity+r.issued_quantity<0 THEN 'negative_review'
  WHEN r.observed_quantity-r.received_quantity+r.issued_quantity=0 THEN 'zero_reviewed'
  WHEN c.unit_cost_toman IS NULL THEN 'cost_missing'
  WHEN c.cost_status='estimate' THEN 'estimated_reviewed'
  ELSE 'non_estimated_reviewed' END AS reconciliation_status,
 CASE WHEN r.observed_quantity-r.received_quantity+r.issued_quantity=0 THEN 0::numeric
 WHEN r.observed_quantity-r.received_quantity+r.issued_quantity>0 AND c.unit_cost_toman IS NOT NULL THEN
 (r.observed_quantity-r.received_quantity+r.issued_quantity)::numeric*c.unit_cost_toman END AS value_toman
FROM opening_capture_items i
LEFT JOIN LATERAL (SELECT * FROM opening_stock_reconciliation r WHERE
 r.capture_id=i.capture_id AND r.source_kind=i.source_kind AND r.external_id=i.external_id AND r.parent_id=i.parent_id
 ORDER BY r.id DESC LIMIT 1) r ON true
LEFT JOIN opening_purchase_cost_review c ON c.source_kind=i.source_kind AND c.external_id::text=i.external_id;
INSERT INTO migrations(version,applied) VALUES('007',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
