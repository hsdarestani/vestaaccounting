BEGIN;
CREATE TABLE IF NOT EXISTS woo_revenue_drafts (
 external_id text PRIMARY KEY CHECK(external_id ~ '^[1-9][0-9]{0,15}$'),
 revision_id bigint NOT NULL REFERENCES raw_revisions(id),
 journal_id text NOT NULL UNIQUE REFERENCES journals(id),
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS woo_revenue_drafts_guard ON woo_revenue_drafts;
CREATE TRIGGER woo_revenue_drafts_guard BEFORE UPDATE OR DELETE ON woo_revenue_drafts
 FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
INSERT INTO migrations(version,applied) VALUES('008',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
