BEGIN;
SELECT pg_advisory_xact_lock(20261127);

-- Raw evidence is retained verbatim. Corrections change the current reference price
-- through a new revision without editing this import or any financial document.
CREATE TABLE IF NOT EXISTS opening_input_costs_v1 (
 external_id bigint PRIMARY KEY CHECK(external_id>0),
 unit_cost_toman bigint NOT NULL CHECK(unit_cost_toman>0),
 cost_status text NOT NULL CHECK(cost_status IN ('reference','owner_entered','estimate')),
 priority_review boolean NOT NULL,
 source_kind text NOT NULL CHECK(source_kind IN ('products','variations')),
 imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS opening_input_balances_v1 (
 evidence_date date NOT NULL,
 line_key text NOT NULL,
 account_kind text NOT NULL CHECK(account_kind IN ('bank','cash','gateway','supplier_payable')),
 display_name text NOT NULL,
 amount_toman numeric(20,2) NOT NULL CHECK(amount_toman>=0),
 evidence_note text NOT NULL,
 PRIMARY KEY(evidence_date,line_key)
);
CREATE TABLE IF NOT EXISTS purchase_cost_revisions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 external_id bigint NOT NULL REFERENCES opening_input_costs_v1(external_id),
 unit_cost_toman bigint NOT NULL CHECK(unit_cost_toman BETWEEN 1 AND 1000000000000),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 250),
 actor text NOT NULL,
 at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_cost_revision_item ON purchase_cost_revisions(external_id,id DESC);
CREATE OR REPLACE VIEW opening_purchase_cost_review AS
SELECT c.external_id,c.source_kind,c.unit_cost_toman AS original_cost_toman,
 c.cost_status AS original_status,c.priority_review AS original_priority_review,
 coalesce(r.unit_cost_toman,c.unit_cost_toman) AS unit_cost_toman,
 CASE WHEN r.id IS NULL THEN c.cost_status ELSE 'owner_entered' END AS cost_status,
 c.priority_review AND r.id IS NULL AS priority_review,coalesce(r.id,0) AS revision,
 r.reason,r.at AS corrected_at
FROM opening_input_costs_v1 c
LEFT JOIN LATERAL (SELECT id,unit_cost_toman,reason,at FROM purchase_cost_revisions
 WHERE external_id=c.external_id ORDER BY id DESC LIMIT 1) r ON true;

CREATE OR REPLACE VIEW opening_stock_cost_review AS
WITH captured AS (
 SELECT i.*,count(*) OVER(PARTITION BY source_kind,external_id) AS occurrences
 FROM opening_capture_items i
)
SELECT i.*,c.unit_cost_toman,c.cost_status,c.priority_review,
 CASE
  WHEN i.occurrences>1 OR (i.source_kind='variations' AND i.parent_id !~ '^[1-9][0-9]*$')
    OR EXISTS(SELECT 1 FROM opening_input_costs_v1 x WHERE x.external_id::text=i.external_id AND x.source_kind<>i.source_kind)
   THEN 'identity_review'
  WHEN i.stock_status='outofstock' AND coalesce(i.stock_quantity,0)>0 THEN 'stock_status_review'
  WHEN i.stock_status='outofstock' THEN 'out_of_stock'
  WHEN i.stock_quantity IS NULL THEN 'quantity_missing'
  WHEN i.stock_quantity<0 THEN 'negative_quantity'
  WHEN i.stock_quantity=0 THEN 'zero_quantity'
  WHEN i.stock_status<>'instock' THEN 'stock_status_review'
  WHEN c.unit_cost_toman IS NULL THEN 'cost_missing'
  WHEN c.cost_status='estimate' THEN 'estimated_cost'
  ELSE 'non_estimated_cost'
 END AS review_status
FROM captured i LEFT JOIN opening_purchase_cost_review c
 ON c.external_id::text=i.external_id AND c.source_kind=i.source_kind;

CREATE TABLE IF NOT EXISTS opening_gateway_rules (
 account text PRIMARY KEY REFERENCES accounts(code),
 evidence_date date NOT NULL,
 line_key text NOT NULL,
 fee_basis text NOT NULL CHECK(fee_basis IN ('unknown','net_reported','net_unconfirmed')),
 rules jsonb NOT NULL,
 FOREIGN KEY(evidence_date,line_key) REFERENCES opening_input_balances_v1(evidence_date,line_key)
);
CREATE TABLE IF NOT EXISTS opening_balance_account_links (
 evidence_date date NOT NULL,
 line_key text NOT NULL,
 account text NOT NULL REFERENCES accounts(code),
 party text REFERENCES parties(id),
 PRIMARY KEY(evidence_date,line_key),
 FOREIGN KEY(evidence_date,line_key) REFERENCES opening_input_balances_v1(evidence_date,line_key)
);
INSERT INTO accounts(code,title,kind) VALUES
 ('1012','بلو بانک ۷۶۴۰','asset'),('1013','بلو بانک ۵۳۸۹','asset'),('1350','مطالبات تسویه شاپینو','asset')
ON CONFLICT DO NOTHING;
INSERT INTO parties(id,kind,name,ref,notes)
 SELECT 'opening-'||line_key,'supplier',display_name,'opening-2026-11-26:'||line_key,'مانده اعلامی در ۵ آذر ۱۴۰۵، نیازمند تطبیق'
 FROM opening_input_balances_v1 WHERE evidence_date='2026-11-26' AND account_kind='supplier_payable'
 AND NOT EXISTS(SELECT 1 FROM parties p WHERE p.kind='supplier' AND p.name=display_name)
ON CONFLICT DO NOTHING;
INSERT INTO opening_balance_account_links(evidence_date,line_key,account,party)
 SELECT b.evidence_date,b.line_key,a.account,
  CASE WHEN b.account_kind='supplier_payable' THEN
   (SELECT min(p.id) FROM parties p WHERE p.kind='supplier' AND p.name=b.display_name HAVING count(*)=1)
  END
 FROM opening_input_balances_v1 b JOIN (VALUES
 ('bank-7640','1012'),('bank-5389','1013'),('cash','1011'),('zibal','1310'),('snapp','1320'),
 ('torob','1330'),('digipay','1340'),('shopino','1350'),('supplier-1','2010'),
 ('supplier-2','2010'),('supplier-3','2010')
 ) a(line_key,account) USING(line_key)
 WHERE b.evidence_date='2026-11-26'
ON CONFLICT DO NOTHING;

INSERT INTO opening_gateway_rules(account,evidence_date,line_key,fee_basis,rules)
 SELECT l.account,l.evidence_date,l.line_key,r.fee_basis,r.rules::jsonb
 FROM opening_balance_account_links l JOIN (VALUES
 ('zibal','unknown','{}'),
 ('snapp','net_reported','{"fee_percent":12,"settlement_every_months":2}'),
 ('torob','net_unconfirmed','{"fee_percent":18,"settlement_every_months":1,"settlement_day":2}'),
 ('digipay','net_unconfirmed','{"settlement_months":7,"credit_provider_fee_percent":13,"credit_payment_fee_percent":[9,10],"wallet_fee_percent":10}'),
 ('shopino','net_reported','{"fee_percent":18,"fee_including_vat_percent":19.8,"settlement_from_day":10,"settlement_through_day":15}')
 ) r(line_key,fee_basis,rules) USING(line_key)
 WHERE l.evidence_date='2026-11-26'
ON CONFLICT DO NOTHING;

INSERT INTO exceptions(id,kind,ref,description,status,at)
 SELECT key,'opening_reconciliation',key,description,'review',now()::text
 FROM (VALUES
 ('opening:balance-window','ساعت برداشت مانده‌های ۵ آذر مشخص نیست. گردش بانک، خرید، پرداخت، تسویه، کارمزد و استرداد تا لحظه برداشت باید به ۳ آذر برگردانده شود.'),
 ('opening:stock-window','زمان مشاهده ووکامرس و موجودی فیزیکی در لحظه شروع باید با گردش کالا تطبیق داده شوند.'),
 ('opening:gateway-net','خالص بودن تروپی و دیجی‌پی، سررسیدهای دیجی‌پی و گزارش تسویه زیبال باید از ارائه‌دهنده تأیید شوند.')
 ) issues(key,description)
 WHERE EXISTS(SELECT 1 FROM opening_input_balances_v1 WHERE evidence_date='2026-11-26')
ON CONFLICT DO NOTHING;

INSERT INTO audit(at,actor,action,ref,description)
 SELECT now()::text,'migration','opening.evidence_link','opening:2026-11-26','مدرک قیمت و مانده برای تطبیق حساب‌ها و طرف‌حساب‌ها آماده شد.'
 WHERE EXISTS(SELECT 1 FROM opening_input_balances_v1 WHERE evidence_date='2026-11-26')
 AND NOT EXISTS(SELECT 1 FROM audit WHERE action='opening.evidence_link' AND ref='opening:2026-11-26');

DROP TRIGGER IF EXISTS opening_input_cost_guard ON opening_input_costs_v1;
CREATE TRIGGER opening_input_cost_guard BEFORE UPDATE OR DELETE ON opening_input_costs_v1
FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP TRIGGER IF EXISTS opening_input_balance_guard ON opening_input_balances_v1;
CREATE TRIGGER opening_input_balance_guard BEFORE UPDATE OR DELETE ON opening_input_balances_v1
FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
DROP TRIGGER IF EXISTS purchase_cost_revision_guard ON purchase_cost_revisions;
CREATE TRIGGER purchase_cost_revision_guard BEFORE UPDATE OR DELETE ON purchase_cost_revisions
FOR EACH ROW EXECUTE FUNCTION runtime_immutable();

INSERT INTO migrations(version,applied) VALUES('004',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
