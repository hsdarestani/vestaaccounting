BEGIN;
CREATE TABLE IF NOT EXISTS purchase_invoice_evidence (
 id text PRIMARY KEY,
 supplier_id text NOT NULL REFERENCES parties(id),
 invoice_ref text NOT NULL CHECK(length(trim(invoice_ref)) BETWEEN 1 AND 120),
 received_at timestamptz NOT NULL,
 total_toman numeric(16,2) NOT NULL CHECK(total_toman>0 AND total_toman<=1000000000000),
 items jsonb NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items)>0),
 evidence_note text NOT NULL CHECK(length(trim(evidence_note)) BETWEEN 1 AND 500),
 actor text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(supplier_id,invoice_ref)
);
CREATE TABLE IF NOT EXISTS purchase_invoice_drafts (
 evidence_id text PRIMARY KEY REFERENCES purchase_invoice_evidence(id),
 journal_id text NOT NULL UNIQUE REFERENCES journals(id)
);
DROP TRIGGER IF EXISTS purchase_invoice_evidence_guard ON purchase_invoice_evidence;
CREATE TRIGGER purchase_invoice_evidence_guard BEFORE UPDATE OR DELETE ON purchase_invoice_evidence FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP TRIGGER IF EXISTS purchase_invoice_drafts_guard ON purchase_invoice_drafts;
CREATE TRIGGER purchase_invoice_drafts_guard BEFORE UPDATE OR DELETE ON purchase_invoice_drafts FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
INSERT INTO migrations(version,applied) VALUES('011',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
