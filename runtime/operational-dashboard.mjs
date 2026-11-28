// Operational order activity, not accounting revenue or bank receipts.
// Only current completed WooCommerce orders, before refunds. Numeric conversion
// happens in PostgreSQL, and exact decimal strings are retained in the response.
export async function operationalDashboard(pool, url) {
 const valid=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toJSON()?.slice(0,10)===v;
 const start=url.searchParams.get('start'),end=url.searchParams.get('end');
 if (!valid(start||'')||!valid(end||'')||start>end) return null;
 const {rows:[result]}=await pool.query(`
 WITH dates AS (
   SELECT (now() AT TIME ZONE 'Asia/Tehran')::date today,
     $1::date first_day,$2::date last_day,$3::date month_start
 ), candidates AS (
   SELECT r.payload->>'date_completed_gmt' completed_at,
     CASE WHEN r.payload->>'total' ~ '^[0-9]{1,20}([.][0-9]{1,6})?$' THEN
       CASE r.payload->>'currency' WHEN 'IRT' THEN (r.payload->>'total')::numeric
       WHEN 'IRR' THEN (r.payload->>'total')::numeric/10 END END amount
   FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id
   WHERE c.kind='orders' AND c.parent_id='' AND r.payload->>'status'='completed'
 ), dated AS (
   SELECT CASE WHEN completed_at ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}$' AND pg_input_is_valid(completed_at,'timestamp')
      THEN (completed_at::timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tehran')::date END AS local_day,amount FROM candidates
 ), ranges AS (
   SELECT 'today' label,today starts,today ends FROM dates UNION ALL
   SELECT 'month',month_start,today FROM dates UNION ALL
   SELECT 'selected',first_day,last_day FROM dates
 ), totals AS (
   SELECT label,count(local_day)::int AS orders,count(local_day) FILTER(WHERE amount IS NULL)::int AS unknown,
     CASE WHEN count(local_day)>0 AND count(local_day) FILTER(WHERE amount IS NULL)=0 THEN trim_scale(sum(amount))::text END AS amount
   FROM ranges LEFT JOIN dated ON local_day BETWEEN starts AND ends GROUP BY label
 ), daily AS (
   SELECT local_day::text AS date,count(*)::int AS orders,count(*) FILTER(WHERE amount IS NULL)::int AS unknown,
     CASE WHEN count(*) FILTER(WHERE amount IS NULL)=0 THEN trim_scale(sum(amount))::text END AS amount
   FROM dated CROSS JOIN dates WHERE local_day BETWEEN first_day AND last_day GROUP BY local_day ORDER BY local_day
 ) SELECT (SELECT jsonb_object_agg(label,to_jsonb(totals)-'label') FROM totals) totals,
   (SELECT coalesce(jsonb_agg(daily ORDER BY date),'[]'::jsonb) FROM daily) daily,
   (SELECT count(*)::int FROM dated WHERE local_day IS NULL) undated,
   (SELECT last_success FROM sync_control WHERE id=1) last_sync
 `,[start,end,valid(url.searchParams.get('month_start')||'')?url.searchParams.get('month_start'):start]);
 return {...result,start,end,financial_verified:false};
}

// Live source catalog is distinct from the accounting inventory. The selector
// returns only the fields required to identify a purchasable source item.
export async function searchPurchaseCatalog(pool, query) {
 const term=String(query||'').trim().slice(0,100);
 const {rows}=await pool.query(`
 WITH catalog AS (
 SELECT c.kind source_kind,c.external_id,c.parent_id,
    coalesce(nullif(r.payload->>'name',''),p.payload->>'name','نام نامشخص') name,
    coalesce(r.payload->>'sku','') sku,
    CASE WHEN c.kind='variations' THEN coalesce((SELECT string_agg(a->>'option',' / ')
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.payload->'attributes')='array' THEN r.payload->'attributes' ELSE '[]'::jsonb END) a),'') ELSE '' END variant
 FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id
 LEFT JOIN raw_current parent ON c.kind='variations' AND parent.kind='products' AND parent.external_id=c.parent_id AND parent.parent_id=''
 LEFT JOIN raw_revisions p ON p.id=parent.revision_id
 WHERE (c.kind='products' AND r.payload->>'type'='simple') OR c.kind='variations'
 ) SELECT * FROM catalog WHERE $1='' OR strpos(lower(name||' '||sku||' '||variant),lower($1))>0
 ORDER BY name,variant,external_id LIMIT 50`,[term]);
 return {rows};
}
