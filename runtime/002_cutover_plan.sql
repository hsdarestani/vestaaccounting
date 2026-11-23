-- Owner-confirmed planned accounting cutover, Tehran local midnight on 2026-11-24.
-- Metadata only; neither an opening balance nor authorization to post financial entries.
BEGIN;
CREATE TABLE IF NOT EXISTS accounting_cutover (
 id integer PRIMARY KEY CHECK(id=1),
 effective_at_utc timestamptz NOT NULL,
 timezone text NOT NULL CHECK(timezone='Asia/Tehran'),
 currency_unit text NOT NULL CHECK(currency_unit='TOMAN'),
 status text NOT NULL DEFAULT 'planned' CHECK(status IN('planned','reviewed','approved')),
 stock_snapshot_status text NOT NULL DEFAULT 'not_captured' CHECK(stock_snapshot_status IN('not_captured','captured','reconciled')),
 confirmed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO accounting_cutover(id,effective_at_utc,timezone,currency_unit,status,stock_snapshot_status)
VALUES (1,'2026-11-23 20:30:00+00','Asia/Tehran','TOMAN','planned','not_captured')
ON CONFLICT (id) DO NOTHING;
DO $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM accounting_cutover
   WHERE id=1 AND effective_at_utc='2026-11-23 20:30:00+00'::timestamptz
   AND timezone='Asia/Tehran' AND currency_unit='TOMAN'
 ) THEN
   RAISE EXCEPTION 'Existing cutover differs from owner-approved date; manual review required';
 END IF;
END $$;
COMMIT;
