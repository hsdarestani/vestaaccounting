-- Read-only source evidence for opening inventory preparation.
-- This is NOT an approved inventory balance and authorizes no journal postings.
BEGIN;
CREATE TABLE IF NOT EXISTS opening_capture (
 id integer PRIMARY KEY CHECK(id=1),
 cutover_at timestamptz NOT NULL,
 observed_at timestamptz NOT NULL,
 last_full_sync_at timestamptz,
 verification_status text NOT NULL DEFAULT 'needs_review' CHECK (verification_status='needs_review'),
 source text NOT NULL DEFAULT 'woocommerce_raw_evidence',
 CHECK (observed_at>=cutover_at)
);
CREATE TABLE IF NOT EXISTS opening_capture_items (
 capture_id integer NOT NULL DEFAULT 1 REFERENCES opening_capture(id),
 source_kind text NOT NULL CHECK(source_kind IN('products','variations')),
 external_id text NOT NULL,
 parent_id text NOT NULL DEFAULT '',
 revision_id bigint NOT NULL REFERENCES raw_revisions(id),
 source_checked_at timestamptz NOT NULL,
 name text NOT NULL,
 sku text NOT NULL,
 stock_quantity bigint,
 stock_status text NOT NULL,
 manage_stock text NOT NULL,
 price text,
 currency text,
 PRIMARY KEY(capture_id,source_kind,external_id,parent_id)
);
CREATE INDEX IF NOT EXISTS opening_capture_stock_issues ON opening_capture_items(source_kind,stock_quantity);
CREATE OR REPLACE VIEW opening_live_review AS
SELECT
 c.kind AS source_kind,c.external_id,c.parent_id,c.revision_id,c.checked_at AS source_checked_at,
 COALESCE(r.payload->>'name','') AS name,
 COALESCE(r.payload->>'sku','') AS sku,
 CASE WHEN COALESCE(r.payload->>'stock_quantity','') ~ '^-?[0-9]{1,13}$'
 THEN (r.payload->>'stock_quantity')::bigint ELSE NULL END AS stock_quantity,
 COALESCE(r.payload->>'stock_status','unknown') AS stock_status,
 COALESCE(r.payload->>'manage_stock','unknown') AS manage_stock,
 r.payload->>'price' AS price,
 r.payload->>'currency' AS currency
FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id
WHERE c.kind='variations'
   OR (c.kind='products' AND r.payload->>'type'='simple');
INSERT INTO migrations(version,applied) VALUES('003',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
