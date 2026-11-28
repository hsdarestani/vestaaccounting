import {salesProposalList,createRevenueDraft} from './woo-sale-proposals.mjs';
// Queue processes only qualified draft documents. Never posts, estimates COGS,
// or infers bank receipts. Stable order/revision identity survives restarts.
export async function runWooJournalQueue(pool,{limit=15,retryReview=false}={}){
 const bound=Math.max(1,Math.min(50,Number(limit)||15)),lock=await pool.connect();let held=false;
 try{held=(await lock.query('SELECT pg_try_advisory_lock(67226612) ok')).rows[0].ok;if(!held)return {busy:true};
  const initialized=(await lock.query('SELECT last_success IS NOT NULL ready FROM sync_control WHERE id=1')).rows[0].ready;if(!initialized)return {waiting_for_source:true};
  const enqueued=await lock.query(`INSERT INTO woo_journal_queue(order_id,revision_id) SELECT c.external_id,c.revision_id FROM raw_current c JOIN raw_revisions r ON r.id=c.revision_id CROSS JOIN accounting_cutover a
   WHERE c.kind='orders' AND c.parent_id='' AND r.payload->>'status'='completed' AND r.payload->>'date_completed_gmt'>=to_char(a.effective_at_utc AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS')
   AND NOT EXISTS(SELECT 1 FROM woo_journal_queue q WHERE q.order_id=c.external_id AND q.revision_id=c.revision_id) ORDER BY r.payload->>'date_completed_gmt',c.external_id::bigint LIMIT 1000 ON CONFLICT DO NOTHING`);
  await lock.query(`UPDATE woo_journal_queue q SET status='superseded',reason='source_revision_changed',checked_at=now() WHERE q.status IN('pending','review') AND NOT EXISTS(SELECT 1 FROM raw_current c WHERE c.kind='orders' AND c.parent_id='' AND c.external_id=q.order_id AND c.revision_id=q.revision_id)`);
  if(retryReview)await lock.query("UPDATE woo_journal_queue SET status='pending',next_attempt_at=now() WHERE status='review'");
  const {rows}=await lock.query("SELECT order_id,revision_id FROM woo_journal_queue WHERE status='pending' AND next_attempt_at<=now() ORDER BY next_attempt_at,order_id::bigint LIMIT $1",[bound]);let drafted=0,review=0,waiting=0;
  for(const row of rows){try{const {rows:[proposal]}=await salesProposalList(pool,new URL('https://example.invalid/?id='+row.order_id+'&start=2026-11-24'));
    let status='review',reason='source_validation';
    if(proposal?.revision_id!==row.revision_id){status='superseded';reason='source_revision_changed';}
    else if(proposal.draft_status==='draft_created'){status='drafted';reason='';}
    else if(proposal.draft_status==='draft_candidate'){
      const period=await lock.query('SELECT 1 FROM periods WHERE $1::date BETWEEN starts AND ends AND locked=0',[proposal.local_date]);
      if(period.rowCount!==1){status='pending';reason='period_required';}
      else{const result=await createRevenueDraft(pool,{external_id:row.order_id,revision_id:row.revision_id},'woo-journal-automation');if(result.error){status='review';reason='draft_validation';}else{status='drafted';reason='';}}
    }else reason=proposal.draft_status==='draft_stale'?'stale_draft':proposal.draft_status==='precision_review'?'precision_review':'source_validation';
    await lock.query("UPDATE woo_journal_queue SET status=$3,reason=$4,attempts=attempts+1,checked_at=now(),next_attempt_at=now()+interval '15 minutes' WHERE order_id=$1 AND revision_id=$2",[row.order_id,row.revision_id,status,reason]);if(status==='drafted')drafted++;else if(status==='pending')waiting++;else review++;
   }catch{await lock.query("UPDATE woo_journal_queue SET reason='retryable_failure',attempts=attempts+1,checked_at=now(),next_attempt_at=now()+interval '15 minutes' WHERE order_id=$1 AND revision_id=$2",[row.order_id,row.revision_id]);waiting++;}}
  return {enqueued:enqueued.rowCount,scanned:rows.length,drafted,review,waiting};
 }finally{try{if(held)await lock.query('SELECT pg_advisory_unlock(67226612)');}finally{lock.release();}}
}
export async function wooJournalQueueList(pool,url){const page=Math.max(0,Math.min(1000,Math.trunc(Number(url.searchParams.get('page'))||0)));const {rows}=await pool.query(`SELECT q.order_id,q.revision_id,q.status queue_status,q.reason,q.attempts,q.checked_at,j.ref draft_ref,j.status journal_status FROM woo_journal_queue q LEFT JOIN woo_revenue_drafts d ON d.external_id=q.order_id AND d.revision_id=q.revision_id LEFT JOIN journals j ON j.id=d.journal_id ORDER BY q.checked_at DESC NULLS FIRST,q.order_id::bigint LIMIT 100 OFFSET $1`,[page*100]);const {rows:summary}=await pool.query('SELECT status queue_status,count(*)::int count FROM woo_journal_queue GROUP BY status ORDER BY status');return {rows,summary};}
