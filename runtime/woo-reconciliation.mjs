// WooCommerce indicates order and refund activity. Bank receipt, provider fees,
// physical returns and accounting approval require their own evidence.
export async function wooReconciliation(pool,url){
 const start=url.searchParams.get('start')||'2026-11-24';
 const end=url.searchParams.get('end')||'2026-11-26';
 const page=Math.max(0,Math.min(1000,Math.trunc(Number(url.searchParams.get('page'))||0)));
 const dateValid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T00:00:00Z').toJSON()?.slice(0,10)===value;
 if(!dateValid(start)||!dateValid(end)||start>end)return {rows:[],summary:[],start,end};
 const result=(await pool.query(`
  WITH bounds AS (
   SELECT to_char(greatest($1::date::timestamp AT TIME ZONE 'Asia/Tehran',effective_at_utc)
    AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') AS first_at,
    to_char((($2::date+1)::timestamp AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS') AS last_at FROM accounting_cutover WHERE id=1
  ), base AS (
   SELECT c.kind,c.external_id,c.parent_id,r.payload,
    coalesce(o.payload,r.payload) AS order_payload,
    r.payload->>'date_created_gmt' AS created_at,
    r.payload->>'date_paid_gmt' AS paid_at
   FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id
   LEFT JOIN raw_current parent ON c.kind='refunds' AND parent.kind='orders'
    AND parent.external_id=c.parent_id AND parent.parent_id=''
   LEFT JOIN raw_revisions o ON o.id=parent.revision_id
   WHERE c.kind IN('orders','refunds')
  ), candidate AS (
   SELECT b.*,event.event_kind,event.event_at,event.amount
   FROM base b
   CROSS JOIN LATERAL (VALUES
    (CASE WHEN b.kind='refunds' THEN 'refund_created' ELSE 'order_created' END,b.created_at,
     CASE WHEN b.kind='refunds' THEN b.payload->>'amount' ELSE b.payload->>'total' END),
    ('order_paid',CASE WHEN b.kind='orders' THEN b.paid_at END,b.payload->>'total')
   ) event(event_kind,event_at,amount)
   CROSS JOIN bounds
   WHERE event_at>=first_at AND event_at<last_at
  ), normalized AS (
   SELECT c.kind,c.external_id,c.parent_id,c.event_kind,
    (c.event_at::timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tehran')::date AS local_date,
    c.order_payload->>'status' AS order_status,
    nullif(c.order_payload->>'payment_method','') AS payment_method,
    c.order_payload->>'currency' AS currency,
    CASE WHEN c.amount ~ '^[0-9]{1,20}([.][0-9]{1,6})?$' THEN CASE c.order_payload->>'currency'
     WHEN 'IRT' THEN c.amount::numeric WHEN 'IRR' THEN trim_scale(c.amount::numeric/10) END END AS amount_toman
   FROM candidate c
  ), summary AS (
   SELECT event_kind,payment_method,count(*) AS count,count(*) FILTER(WHERE amount_toman IS NULL) AS amount_unknown,
    coalesce(sum(amount_toman),0)::text AS amount_toman FROM normalized
   GROUP BY event_kind,payment_method ORDER BY event_kind,payment_method
  ), display AS (
   SELECT *,amount_toman::text AS amount_exact FROM normalized
   ORDER BY local_date DESC,event_kind,external_id::bigint,parent_id
   LIMIT 100 OFFSET $3
  )
  SELECT jsonb_build_object(
   'rows',coalesce((SELECT jsonb_agg(to_jsonb(display)-'amount_toman') FROM display),'[]'::jsonb),
   'summary',coalesce((SELECT jsonb_agg(to_jsonb(summary)) FROM summary),'[]'::jsonb)
  ) AS result`,[start,end,page*100])).rows[0].result;
 return {...result,start,end};
}
