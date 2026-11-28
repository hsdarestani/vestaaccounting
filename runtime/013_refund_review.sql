BEGIN;
CREATE TABLE IF NOT EXISTS woo_refund_review_drafts (
 order_id text NOT NULL,
 refund_id text NOT NULL,
 refund_revision bigint NOT NULL REFERENCES raw_revisions(id),
 journal_id text NOT NULL UNIQUE REFERENCES journals(id),
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(order_id,refund_id)
);
DROP TRIGGER IF EXISTS woo_refund_review_drafts_guard ON woo_refund_review_drafts;
CREATE TRIGGER woo_refund_review_drafts_guard BEFORE UPDATE OR DELETE ON woo_refund_review_drafts FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
INSERT INTO migrations(version,applied) VALUES('013',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
