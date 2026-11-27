// Read-only indicative merchandise margin, never a ledger posting or historical COGS.
// Only complete paid order lines with matching product identity and a reference cost
// enter the margin totals. Refunds and unsupported rows remain visible as exclusions.
export async function paidMarginReview(pool,start,end){
 const {rows}=await pool.query(`
 WITH bounds AS (
  SELECT to_char(greatest($1::date::timestamp AT TIME ZONE 'Asia/Tehran',effective_at_utc)
    AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') first_at,
   to_char((($2::date+1)::timestamp AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS') last_at FROM accounting_cutover WHERE id=1
 ), paid AS (
  SELECT c.external_id,r.payload,
   ((r.payload->>'date_paid_gmt')::timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tehran')::date local_date,
   CASE WHEN r.payload->>'status' NOT IN ('processing','completed') OR r.payload->>'status' IS NULL
      THEN 'status_review'
    WHEN jsonb_typeof(r.payload->'refunds') IS DISTINCT FROM 'array' THEN 'refund_evidence_missing'
    WHEN r.payload->'refunds' <> '[]'::jsonb OR EXISTS(
      SELECT 1 FROM raw_current f WHERE f.kind='refunds' AND f.parent_id=c.external_id)
      THEN 'refund_review'
    WHEN r.payload->>'currency' NOT IN ('IRT','IRR') OR r.payload->>'currency' IS NULL THEN 'currency_review'
    ELSE NULL END exclusion
  FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id CROSS JOIN bounds b
  WHERE c.kind='orders' AND c.parent_id='' AND r.payload->>'date_paid_gmt'>=b.first_at
    AND r.payload->>'date_paid_gmt'<b.last_at
 ), lines AS (
  SELECT p.external_id,p.local_date,p.exclusion,i.item,
   CASE WHEN i.item->>'quantity' ~ '^[1-9][0-9]{0,8}$' THEN (i.item->>'quantity')::numeric END qty,
   CASE WHEN i.item->>'total' ~ '^[0-9]{1,20}([.][0-9]{1,6})?$'
    THEN (i.item->>'total')::numeric / CASE WHEN p.payload->>'currency'='IRR' THEN 10 ELSE 1 END END net,
   CASE WHEN i.item->>'variation_id' ~ '^[1-9][0-9]{0,15}$' THEN 'variations'
    WHEN i.item->>'variation_id'='0' THEN 'products' END source_kind,
   CASE WHEN i.item->>'variation_id' ~ '^[1-9][0-9]{0,15}$' THEN i.item->>'variation_id'
    WHEN i.item->>'variation_id'='0' THEN i.item->>'product_id' END item_id
  FROM paid p LEFT JOIN LATERAL jsonb_array_elements(
   CASE WHEN jsonb_typeof(p.payload->'line_items')='array' THEN p.payload->'line_items' ELSE '[]'::jsonb END
  ) i(item) ON true
 ), matched AS (
  SELECT l.*,k.unit_cost_toman,k.cost_status,
   EXISTS(SELECT 1 FROM raw_current rc JOIN raw_revisions rr ON rr.id=rc.revision_id
    WHERE rc.kind=l.source_kind AND rc.external_id=l.item_id
    AND ((l.source_kind='variations' AND rc.parent_id=l.item->>'product_id')
      OR (l.source_kind='products' AND rc.parent_id='' AND rr.payload->>'type'='simple'))) AS identity_ok
  FROM lines l LEFT JOIN opening_purchase_cost_review k
   ON k.external_id::text=l.item_id AND k.source_kind=l.source_kind
 ), orders AS (
  SELECT external_id,local_date,
   coalesce(exclusion,CASE
    WHEN bool_or(item IS NULL OR qty IS NULL OR net IS NULL OR NOT identity_ok OR unit_cost_toman IS NULL)
      THEN 'line_or_cost_review'
    WHEN bool_or(cost_status='estimate') THEN 'estimated_reference'
    ELSE 'non_estimated_reference' END) AS margin_status,
   sum(net) merchandise_net, sum(qty*unit_cost_toman) reference_cost
  FROM matched GROUP BY external_id,local_date,exclusion
 )
 SELECT local_date::text,margin_status,count(*)::integer AS count,
  CASE WHEN margin_status IN ('estimated_reference','non_estimated_reference')
   THEN trim_scale(sum(merchandise_net))::text END AS merchandise_net_toman,
  CASE WHEN margin_status IN ('estimated_reference','non_estimated_reference')
   THEN trim_scale(sum(reference_cost))::text END AS reference_cost_toman,
  CASE WHEN margin_status IN ('estimated_reference','non_estimated_reference')
   THEN trim_scale(sum(merchandise_net-reference_cost))::text END AS indicative_margin_toman
 FROM orders GROUP BY local_date,margin_status ORDER BY local_date DESC,margin_status
 `,[start,end]);
 return rows;
}
