-- Authoritative PostgreSQL runtime for a dedicated Vesta Accounting database.
-- Separate from the storefront and from the D1 evaluation database.
BEGIN;
CREATE TABLE IF NOT EXISTS migrations(version text PRIMARY KEY,applied text NOT NULL);
CREATE TABLE IF NOT EXISTS accounts(code text PRIMARY KEY,title text NOT NULL,kind text NOT NULL CHECK(kind IN('asset','liability','equity','revenue','expense')));
CREATE TABLE IF NOT EXISTS periods(id text PRIMARY KEY,title text NOT NULL,starts date NOT NULL,ends date NOT NULL,locked integer NOT NULL DEFAULT 0 CHECK(locked IN(0,1)),CHECK(starts<=ends),EXCLUDE USING gist(daterange(starts,ends,'[]') WITH &&));
CREATE TABLE IF NOT EXISTS journals(id text PRIMARY KEY,ref text NOT NULL UNIQUE,date date NOT NULL,period text NOT NULL REFERENCES periods(id),description text NOT NULL,status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','posted')),actor text NOT NULL,approved_by text,posted_by text,reverses text UNIQUE REFERENCES journals(id),at text NOT NULL);
CREATE TABLE IF NOT EXISTS lines(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,journal text NOT NULL REFERENCES journals(id),account text NOT NULL REFERENCES accounts(code),detail text NOT NULL DEFAULT '',debit bigint NOT NULL CHECK(debit BETWEEN 0 AND 1000000000000),credit bigint NOT NULL CHECK(credit BETWEEN 0 AND 1000000000000),CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)));
CREATE INDEX IF NOT EXISTS idx_lines_account ON lines(account,journal);
CREATE INDEX IF NOT EXISTS idx_lines_journal ON lines(journal);
CREATE INDEX IF NOT EXISTS idx_journals_date ON journals(date,status);
CREATE OR REPLACE FUNCTION runtime_journal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p periods%ROWTYPE; n bigint; balance numeric;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable journal'; END IF;
 IF TG_OP='INSERT' THEN IF NEW.status<>'draft' THEN RAISE EXCEPTION 'journal must begin draft'; END IF; RETURN NEW; END IF;
 IF OLD.status='posted' OR (NEW.id,NEW.ref,NEW.date,NEW.period,NEW.description,NEW.actor,NEW.reverses,NEW.at) IS DISTINCT FROM (OLD.id,OLD.ref,OLD.date,OLD.period,OLD.description,OLD.actor,OLD.reverses,OLD.at) THEN RAISE EXCEPTION 'immutable journal'; END IF;
 IF NOT ((OLD.status='draft' AND NEW.status='approved') OR (OLD.status='approved' AND NEW.status='posted' AND NEW.approved_by=OLD.approved_by)) THEN RAISE EXCEPTION 'invalid transition'; END IF;
 SELECT * INTO p FROM periods WHERE id=NEW.period FOR SHARE;
 IF NOT FOUND OR p.locked=1 OR NEW.date NOT BETWEEN p.starts AND p.ends THEN RAISE EXCEPTION 'period locked'; END IF;
 SELECT count(*),COALESCE(sum(debit::numeric-credit::numeric),0) INTO n,balance FROM lines WHERE journal=NEW.id;
 IF n<2 OR balance<>0 THEN RAISE EXCEPTION 'unbalanced journal'; END IF;
 IF NEW.approved_by IS NULL OR (NEW.status='posted' AND NEW.posted_by IS NULL) THEN RAISE EXCEPTION 'approval missing'; END IF;
 -- Serialize balance-sensitive posting on account keys in a deterministic order.
 IF NEW.status='posted' THEN PERFORM a.code FROM accounts a WHERE a.code IN(SELECT account FROM lines WHERE journal=NEW.id) ORDER BY a.code FOR UPDATE; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION runtime_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'immutable line'; END IF;
 SELECT status INTO s FROM journals WHERE id=NEW.journal FOR UPDATE;
 IF s IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'closed journal'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_guard ON journals;
CREATE TRIGGER journal_guard BEFORE INSERT OR UPDATE OR DELETE ON journals FOR EACH ROW EXECUTE FUNCTION runtime_journal_guard();
DROP TRIGGER IF EXISTS line_guard ON lines;
CREATE TRIGGER line_guard BEFORE INSERT OR UPDATE OR DELETE ON lines FOR EACH ROW EXECUTE FUNCTION runtime_line_guard();
CREATE TABLE IF NOT EXISTS parties(id text PRIMARY KEY,kind text NOT NULL CHECK(kind IN('customer','supplier')),name text NOT NULL,ref text NOT NULL UNIQUE,notes text NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS products(id text PRIMARY KEY,product_id bigint NOT NULL,variation_id bigint NOT NULL,name text NOT NULL,variant text NOT NULL DEFAULT '',sku text NOT NULL UNIQUE,category text NOT NULL,quantity bigint NOT NULL DEFAULT 0 CHECK(quantity>=0),value bigint CHECK(value>=0),version bigint NOT NULL DEFAULT 0,UNIQUE(product_id,variation_id));
CREATE TABLE IF NOT EXISTS documents(id text PRIMARY KEY,kind text NOT NULL,ref text NOT NULL UNIQUE,date date NOT NULL,party text REFERENCES parties(id),product text REFERENCES products(id),quantity bigint NOT NULL DEFAULT 0,subtotal bigint NOT NULL DEFAULT 0,discount bigint NOT NULL DEFAULT 0,shipping bigint NOT NULL DEFAULT 0,tax bigint NOT NULL DEFAULT 0,gross bigint NOT NULL DEFAULT 0,cost bigint,channel text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'posted',journal text NOT NULL UNIQUE REFERENCES journals(id),note text NOT NULL DEFAULT '',related text UNIQUE REFERENCES documents(id));
CREATE INDEX IF NOT EXISTS idx_docs_kind_date ON documents(kind,date);
CREATE INDEX IF NOT EXISTS idx_docs_party ON documents(party);
CREATE OR REPLACE FUNCTION runtime_settlement_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.kind='settlement' AND (SELECT COALESCE(SUM(l.debit-l.credit),0) FROM lines l JOIN journals j ON j.id=l.journal WHERE j.status='posted' AND l.account=NEW.channel)<0 THEN RAISE EXCEPTION 'settlement exceeds clearing balance'; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS settlement_guard ON documents;
CREATE TRIGGER settlement_guard BEFORE INSERT ON documents FOR EACH ROW EXECUTE FUNCTION runtime_settlement_guard();
CREATE TABLE IF NOT EXISTS movements(id text PRIMARY KEY,doc text NOT NULL UNIQUE REFERENCES documents(id),product text NOT NULL REFERENCES products(id),date date NOT NULL,kind text NOT NULL,delta bigint NOT NULL CHECK(delta<>0),value_delta bigint,expected_version bigint NOT NULL,qty_after bigint NOT NULL CHECK(qty_after>=0),value_after bigint CHECK(value_after>=0));
CREATE INDEX IF NOT EXISTS idx_moves_product ON movements(product,date);
CREATE OR REPLACE FUNCTION runtime_stock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p products%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'immutable stock movement'; END IF;
 SELECT * INTO p FROM products WHERE id=NEW.product FOR UPDATE;
 IF NOT FOUND OR p.version<>NEW.expected_version OR p.quantity+NEW.delta<>NEW.qty_after THEN RAISE EXCEPTION 'inventory stale'; END IF;
 IF ((p.value IS NULL AND NEW.value_delta IS NULL AND NEW.value_after IS NULL) OR (p.value IS NOT NULL AND NEW.value_delta IS NOT NULL AND p.value+NEW.value_delta=NEW.value_after) OR (p.quantity=0 AND p.value IS NULL AND NEW.value_delta IS NOT NULL AND NEW.value_after=NEW.value_delta)) IS NOT TRUE THEN RAISE EXCEPTION 'valuation inconsistent'; END IF;
 UPDATE products SET quantity=NEW.qty_after,value=NEW.value_after,version=version+1 WHERE id=NEW.product; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS movement_guard ON movements;
CREATE TRIGGER movement_guard BEFORE INSERT OR UPDATE OR DELETE ON movements FOR EACH ROW EXECUTE FUNCTION runtime_stock_guard();
CREATE OR REPLACE FUNCTION runtime_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable record'; END $$;
DROP TRIGGER IF EXISTS doc_guard ON documents;
CREATE TRIGGER doc_guard BEFORE UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
CREATE TABLE IF NOT EXISTS exceptions(id text PRIMARY KEY,kind text NOT NULL,ref text NOT NULL UNIQUE,expected bigint,observed bigint,description text NOT NULL,status text NOT NULL DEFAULT 'open' CHECK(status IN('open','review','resolved')),resolution text,at text NOT NULL);
CREATE TABLE IF NOT EXISTS opening_refs(id text PRIMARY KEY,product text NOT NULL UNIQUE REFERENCES products(id),quantity bigint NOT NULL CHECK(quantity>=0),evidence text NOT NULL,at text NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,at text NOT NULL,actor text NOT NULL,action text NOT NULL,ref text NOT NULL,description text NOT NULL DEFAULT '');
DROP TRIGGER IF EXISTS audit_guard ON audit;
CREATE TRIGGER audit_guard BEFORE UPDATE OR DELETE ON audit FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY,csrf text NOT NULL,expires bigint NOT NULL,actor text NOT NULL,role text NOT NULL CHECK(role IN('owner','viewer')));
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires);
CREATE TABLE IF NOT EXISTS login_limits(ip_hash text PRIMARY KEY,"window" bigint NOT NULL,n integer NOT NULL);
CREATE TABLE IF NOT EXISTS app_users(username text PRIMARY KEY,password_hash text NOT NULL,role text NOT NULL CHECK(role IN('owner','viewer')),totp_secret text,enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());
-- Append-only source evidence. An immutable raw revision is NOT a financial document.
CREATE TABLE IF NOT EXISTS raw_revisions(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,kind text NOT NULL,external_id text NOT NULL,parent_id text NOT NULL DEFAULT '',fingerprint text NOT NULL,modified text,payload jsonb NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),UNIQUE(kind,external_id,parent_id,fingerprint));
CREATE INDEX IF NOT EXISTS raw_revisions_identity ON raw_revisions(kind,external_id,parent_id);
DROP TRIGGER IF EXISTS raw_guard ON raw_revisions;
CREATE TRIGGER raw_guard BEFORE UPDATE OR DELETE ON raw_revisions FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
CREATE TABLE IF NOT EXISTS raw_current(kind text NOT NULL,external_id text NOT NULL,parent_id text NOT NULL DEFAULT '',revision_id bigint NOT NULL REFERENCES raw_revisions(id),modified text,PRIMARY KEY(kind,external_id,parent_id));
CREATE TABLE IF NOT EXISTS sync_state(kind text PRIMARY KEY,watermark text,cursor jsonb,status text NOT NULL DEFAULT 'pending',last_success timestamptz,expected_count bigint,processed_count bigint NOT NULL DEFAULT 0,last_error text);
CREATE TABLE IF NOT EXISTS sync_runs(id text PRIMARY KEY,started timestamptz NOT NULL DEFAULT now(),finished timestamptz,status text NOT NULL,reason text NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS sync_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,event_key text NOT NULL UNIQUE,topic text NOT NULL,fingerprint text NOT NULL,source_id text NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processed','review')),attempts integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sync_control(id integer PRIMARY KEY CHECK(id=1),requested boolean NOT NULL DEFAULT true,last_success timestamptz,last_scan timestamptz,last_error text);
INSERT INTO sync_control(id) VALUES(1) ON CONFLICT DO NOTHING;
INSERT INTO migrations VALUES('001',now()::text) ON CONFLICT DO NOTHING;
INSERT INTO accounts VALUES ('1010','بانک اصلی','asset'),('1011','صندوق','asset'),('1100','حساب‌های دریافتنی','asset'),('1200','موجودی کالا','asset'),('1310','درگاه زیبال','asset'),('1320','اسنپ‌پی','asset'),('1330','تروپی','asset'),('1340','دیجی‌پی','asset'),('1390','درگاه دیگر','asset'),('2010','حساب‌های پرداختنی','liability'),('2020','پیش‌دریافت مشتری','liability'),('2100','مالیات پرداختنی','liability'),('3010','سرمایه و افتتاحیه','equity'),('4010','فروش کالا','revenue'),('4020','درآمد ارسال','revenue'),('4030','تخفیفات فروش','revenue'),('4040','برگشت از فروش','revenue'),('5010','بهای تمام‌شده','expense'),('5020','کارمزد درگاه','expense'),('5030','هزینه ارسال','expense'),('5040','تبلیغات','expense'),('5050','ضایعات','expense'),('5090','سایر هزینه‌ها','expense') ON CONFLICT DO NOTHING;
COMMIT;
