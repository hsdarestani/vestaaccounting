"""Durable normalized financial evidence and deterministic draft generation.

The policy below is for synthetic evaluation only, not approved tax or
revenue-recognition guidance. No event is permitted to post a journal.
"""
import hmac
import hashlib
import json
import sqlite3
import time
from .ledger import RuleError, GATEWAYS, amt, canonical, digest, day, line, need_text, stamp

RULE_VERSION='retail-evaluation-v1'

def verify_signature(secret, timestamp, signature, raw, now=None):
    if not secret or len(secret)<32 or not isinstance(signature,str):
        return False
    try:
        if abs((time.time() if now is None else now)-int(timestamp))>300:
            return False
        expected=hmac.new(secret.encode(),timestamp.encode()+b'.'+raw,hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected,signature)
    except (TypeError, ValueError, AttributeError):
        return False

def gateway(data):
    try:
        return GATEWAYS[data['gateway']]
    except (KeyError,TypeError) as exc:
        raise RuleError('unsupported or unmapped payment provider') from exc

def rules(kind,data):
    """Return exact entries from independently verified, normalized facts."""
    if not isinstance(data,dict):
        raise RuleError('invalid event facts')
    def money(k,zero=False): return amt(data.get(k),k,zero)
    def party(): return need_text(data.get('party_ref'),'party reference',200)
    if kind=='payment_confirmed':
        p=party(); amount=money('amount')
        return [line(gateway(data),debit=amount,detail=p),line('2020',credit=amount,detail=p)]
    if kind=='sale_fulfilled':
        p=party(); subtotal=money('subtotal'); discount=money('discount',True); shipping=money('shipping',True); tax=money('tax',True); total=money('total')
        if discount>subtotal or subtotal-discount+shipping+tax!=total:
            raise RuleError('sale amount does not reconcile')
        out=[line('1100',debit=total,detail=p),line('4010',credit=subtotal)]
        if discount: out.append(line('4030',debit=discount))
        if shipping: out.append(line('4020',credit=shipping))
        if tax: out.append(line('2100',credit=tax))
        return out
    if kind=='allocate_advance':
        amount=money('amount'); p=party()
        # Allocation evidence has to identify both backing documents. An
        # amount alone is not adequate proof. Automatic matching is not yet enabled.
        need_text(data.get('sale_ref'),'sale evidence'); need_text(data.get('payment_ref'),'payment evidence')
        return [line('2020',debit=amount,detail=p),line('1100',credit=amount,detail=p)]
    if kind=='gateway_settlement':
        gross=money('gross'); net=money('net',True); fee=money('fee',True)
        if gross!=net+fee: raise RuleError('settlement gross does not equal net plus fee')
        need_text(data.get('bank_ref'),'bank statement reference')
        need_text(data.get('batch_ref'),'settlement batch')
        out=[line(gateway(data),credit=gross)]
        if net: out.append(line('1010',debit=net))
        if fee: out.append(line('5020',debit=fee))
        return out
    if kind=='purchase_invoice':
        cost=money('cost'); p=party()
        need_text(data.get('receipt_ref'),'verified inventory receipt')
        return [line('1200',debit=cost),line('2010',credit=cost,detail=p)]
    if kind=='supplier_payment':
        a=money('amount'); p=party()
        return [line('2010',debit=a,detail=p),line('1010',credit=a)]
    if kind=='expense_paid':
        a=money('amount'); account=data.get('expense_account')
        if account not in ('5030','5090'): raise RuleError('expense account requires explicit mapping')
        return [line(account,debit=a),line('1010',credit=a)]
    if kind=='payment_refund_before_fulfillment':
        amount=money('amount'); p=party()
        need_text(data.get('original_payment_ref'),'original payment evidence')
        return [line('2020',debit=amount,detail=p),line(gateway(data),credit=amount,detail=p)]
    raise RuleError('unsupported event or missing accounting policy; review required')

def ingest(ledger,source,event_key,kind,payload):
    source=need_text(source,'source',60); event_key=need_text(event_key,'event key',150); kind=need_text(kind,'event type',80)
    if not isinstance(payload,dict) or len(canonical(payload).encode())>64_000:
        raise RuleError('invalid evidence payload')
    fingerprint=digest({'kind':kind,'payload':payload})
    with ledger.transaction() as c:
        old=c.execute('SELECT * FROM external_event WHERE source=? AND event_key=?',(source,event_key)).fetchone()
        if old:
            if old['fingerprint']!=fingerprint:
                c.execute('INSERT OR IGNORE INTO event_conflict(event_id,fingerprint,evidence,received_at) VALUES (?,?,?,?)',(old['id'],fingerprint,canonical({'kind':kind,'payload':payload}),stamp()))
                ledger.audit(c,'integration','event.conflicting_delivery',old['id'],fingerprint)
                return {'id':old['id'],'status':'conflict','reason':'same delivery identifier with differing evidence'}
            return {'id':old['id'],'status':old['status'],'duplicate':True}
        event_id=c.execute('INSERT INTO external_event(source,event_key,fingerprint,kind,payload,received_at) VALUES (?,?,?,?,?,?)',(source,event_key,fingerprint,kind,canonical(payload),stamp())).lastrowid
        ledger.audit(c,'integration','event.received',event_id,fingerprint)
        return {'id':event_id,'status':'received'}

def process(ledger,event_id,actor):
    with ledger.transaction() as c:
        e=c.execute('SELECT * FROM external_event WHERE id=?',(event_id,)).fetchone()
        if not e: raise RuleError('event not found')
        if c.execute('SELECT 1 FROM event_conflict WHERE event_id=?',(event_id,)).fetchone():
            return {'status':'conflict','reason':'conflicting source evidence; cannot draft automatically','journal_id':e['journal_id']}
        if e['status'] in ('drafted','historical','duplicate'):
            return {'status':e['status'],'journal_id':e['journal_id']}
        payload=json.loads(e['payload']); j=None; reason=None
        c.execute('SAVEPOINT draft_event')
        try:
            cutoff=c.execute("SELECT value FROM setting WHERE key='cutover'").fetchone()
            if not cutoff: raise RuleError('approved cutover date missing')
            occurred=day(payload.get('date')); original=day(payload.get('origin_date'))
            if original>occurred: raise RuleError('original transaction postdates event')
            if original<cutoff['value'] or occurred<cutoff['value']:
                status='historical'; reason='pre-cutover evidence; reference only'
            else:
                need_text(payload.get('evidence_ref'),'independent evidence reference')
                business=need_text(payload.get('business_key'),'business key',130)
                # Evidence references are preserved in immutable event records.
                # The journal is keyed by economic fact, not webhook delivery ID.
                source=f"event:{e['source']}:{e['kind']}:{business}"
                lines=rules(e['kind'],payload.get('facts'))
                old=c.execute('SELECT id FROM journal WHERE source=?',(source,)).fetchone()
                try:
                    j=ledger._draft(c,source,occurred,'رویداد مالی: '+e['kind'],lines,actor,rule_version=RULE_VERSION)
                    status='duplicate' if old else 'drafted'
                except RuleError as exc:
                    if old and str(exc).startswith('source conflict:'):
                        j=old['id']; status='conflict'; reason=str(exc)
                    else: raise
        except (RuleError,sqlite3.IntegrityError) as exc:
            c.execute('ROLLBACK TO draft_event'); j=None; status='review'; reason=str(exc)
        finally:
            c.execute('RELEASE draft_event')
        c.execute('UPDATE external_event SET status=?,reason=?,journal_id=? WHERE id=?',(status,reason,j,event_id))
        ledger.audit(c,actor,'event.'+status,event_id,reason or str(j))
        return {'status':status,'reason':reason,'journal_id':j}
