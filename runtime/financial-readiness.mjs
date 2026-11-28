// Read-only accounting readiness and exact opening proposal. No source data,
 // ledger, or financial authorization is mutated by this report.
export async function financialReadiness(pool){
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const {rows:[meta]}=await conn.query(`
   SELECT c.effective_at_utc,c.status AS cutover_status,c.stock_snapshot_status,
    (SELECT observed_at FROM opening_capture WHERE id=1) AS capture_at,
    (SELECT last_success FROM sync_control WHERE id=1) AS last_sync,
    (SELECT count(*)::int FROM sync_state WHERE status='failed') AS sync_failures,
    (SELECT count(*)::int FROM journals WHERE status='posted') AS posted_journals,
    (SELECT count(*)::int FROM journals WHERE status='draft') AS draft_journals,
    (SELECT count(*)::int FROM periods p WHERE (c.effective_at_utc AT TIME ZONE 'Asia/Tehran')::date BETWEEN p.starts AND p.ends AND p.locked=0) AS opening_periods,
    (SELECT coalesce(sum(l.debit::numeric-l.credit::numeric),0)::text FROM lines l JOIN journals j ON j.id=l.journal WHERE j.status='posted') AS posted_difference_toman
   FROM accounting_cutover c WHERE c.id=1`);
  const {rows:[coverage]}=await conn.query(`
   WITH balances AS (
    SELECT b.*,l.account,l.party,r.id AS revision,
     CASE WHEN r.id IS NOT NULL THEN b.amount_toman-r.increases_toman+r.decreases_toman END AS opening_value
    FROM opening_input_balances_v1 b
    LEFT JOIN opening_balance_account_links l USING(evidence_date,line_key)
    LEFT JOIN LATERAL(SELECT id,increases_toman,decreases_toman FROM opening_balance_bridge_evidence e
     WHERE e.evidence_date=b.evidence_date AND e.line_key=b.line_key ORDER BY id DESC LIMIT 1) r ON true
   ), stock AS (
    SELECT s.*,count(*) OVER(PARTITION BY source_kind,external_id) AS occurrences
    FROM opening_stock_reconciled_review s
   )
   SELECT
    (SELECT count(*)::int FROM opening_input_costs_v1) AS imported_costs,
    (SELECT count(*)::int FROM opening_purchase_cost_review WHERE cost_status='estimate') AS estimated_costs,
    (SELECT count(*)::int FROM opening_purchase_cost_review WHERE priority_review) AS priority_costs,
    (SELECT count(*)::int FROM balances) AS balance_total,
    (SELECT count(*)::int FROM balances WHERE revision IS NOT NULL) AS balance_reconciled,
    (SELECT count(*)::int FROM balances WHERE revision IS NULL) AS balance_missing,
    (SELECT count(*)::int FROM balances WHERE opening_value<0) AS balance_negative,
    (SELECT count(*)::int FROM balances WHERE opening_value>0 AND (account IS NULL OR (account_kind='supplier_payable' AND party IS NULL))) AS balance_unmapped,
    (SELECT count(*)::int FROM balances WHERE mod(opening_value,1)<>0) AS balance_fractional,
    (SELECT count(*)::int FROM stock) AS stock_total,
    (SELECT count(*)::int FROM stock WHERE captured_quantity IS NULL) AS captured_quantity_missing,
    (SELECT count(*)::int FROM stock WHERE reconciliation_revision IS NULL) AS stock_evidence_missing,
    (SELECT count(*)::int FROM stock WHERE reconciliation_status='negative_review') AS stock_negative,
    (SELECT count(*)::int FROM stock WHERE reconciliation_status='cost_missing') AS stock_cost_missing,
    (SELECT count(*)::int FROM stock WHERE reconciliation_status='estimated_reviewed') AS stock_estimated,
    (SELECT count(*)::int FROM stock WHERE occurrences>1 OR (source_kind='variations' AND parent_id !~ '^[1-9][0-9]*$')) AS stock_identity_issues,
    (SELECT count(*)::int FROM exceptions WHERE status<>'resolved') AS unresolved_exceptions,
    (SELECT count(*)::int FROM gateway_settlement_evidence) AS settlement_evidence_count,
    (SELECT count(*)::int FROM gateway_settlement_drafts) AS settlement_draft_count
   `);
  const {rows:preview}=await conn.query(`
   WITH balances AS (
    SELECT b.*,l.account,l.party,b.amount_toman-r.increases_toman+r.decreases_toman AS value
    FROM opening_input_balances_v1 b JOIN opening_balance_account_links l USING(evidence_date,line_key)
    JOIN LATERAL(SELECT increases_toman,decreases_toman FROM opening_balance_bridge_evidence e
     WHERE e.evidence_date=b.evidence_date AND e.line_key=b.line_key ORDER BY id DESC LIMIT 1) r ON true
   ), stock AS (
    SELECT s.*,count(*) OVER(PARTITION BY source_kind,external_id) AS occurrences
    FROM opening_stock_reconciled_review s
   ), proposed AS (
    SELECT b.account,a.title,b.display_name AS detail,b.party,
      CASE WHEN b.account_kind='supplier_payable' THEN 0 ELSE b.value END AS debit,
      CASE WHEN b.account_kind='supplier_payable' THEN b.value ELSE 0 END AS credit
    FROM balances b JOIN accounts a ON a.code=b.account
    WHERE b.value>0 AND (b.account_kind<>'supplier_payable' OR b.party IS NOT NULL)
    UNION ALL
    SELECT '1200','موجودی کالا',reconciliation_status,NULL,sum(value_toman),0
    FROM stock WHERE reconciliation_status IN('estimated_reviewed','non_estimated_reviewed') AND occurrences=1
    AND (source_kind='products' OR parent_id ~ '^[1-9][0-9]*$') GROUP BY reconciliation_status
   ), totals AS (SELECT coalesce(sum(debit-credit),0) AS difference FROM proposed)
   SELECT account,title,detail,party,debit::text,credit::text FROM (
    SELECT * FROM proposed
    UNION ALL SELECT '3010','مانده محاسباتی افتتاحیه','موقت؛ پوشش ناقص ممکن است',NULL,
     greatest(-difference,0),greatest(difference,0) FROM totals WHERE difference<>0
   ) p ORDER BY account,detail`);
  const checks=[
   ['source_sync',meta.last_sync&&meta.sync_failures===0?'reviewed':'required',meta.sync_failures],
   ['opening_period',meta.opening_periods===1?'reviewed':'required',meta.opening_periods],
   ['balance_evidence',coverage.balance_total>0&&coverage.balance_missing===0?'reviewed':'required',coverage.balance_missing],
   ['balance_negative',coverage.balance_negative===0?'reviewed':'required',coverage.balance_negative],
   ['balance_links',coverage.balance_unmapped===0?'reviewed':'required',coverage.balance_unmapped],
   ['ledger_precision','reviewed',coverage.balance_fractional],
   ['stock_evidence',meta.capture_at&&coverage.stock_total>0&&coverage.stock_evidence_missing===0?'reviewed':'required',coverage.stock_evidence_missing],
   ['stock_negative',coverage.stock_negative===0?'reviewed':'required',coverage.stock_negative],
   ['stock_identity',coverage.stock_identity_issues===0?'reviewed':'required',coverage.stock_identity_issues],
   ['stock_cost',coverage.stock_cost_missing===0?'reviewed':'required',coverage.stock_cost_missing],
   ['estimated_stock',coverage.stock_estimated===0?'reviewed':'required',coverage.stock_estimated],
   ['scope_approval','required',null],
   ['posting_gate','required',null]
  ].map(([key,status,count])=>({key,status,count}));
  const {rows:[state]}=await conn.query('SELECT active FROM source_posting_state WHERE id=1');
  if(state.active)for(const check of checks)if(['scope_approval','posting_gate'].includes(check.key))check.status='reviewed';
  await conn.query('COMMIT');
  return {rows:checks,coverage,meta,preview,posting_authorized:state.active,preview_is_partial:!state.active};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
