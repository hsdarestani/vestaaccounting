-- PostgreSQL migration candidate for the future isolated accounting backend.
-- Apply only to a new accounting database, never the storefront database.
BEGIN;
CREATE TABLE schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE accounts(code text PRIMARY KEY,title text NOT NULL,kind text NOT NULL CHECK(kind IN('asset','liability','equity','revenue','expense')),parent text REFERENCES accounts(code),active boolean NOT NULL DEFAULT true);
CREATE TABLE periods(id uuid PRIMARY KEY,title text NOT NULL,starts date NOT NULL,ends date NOT NULL,locked boolean NOT NULL DEFAULT false,CHECK(starts<=ends),EXCLUDE USING gist (daterange(starts,ends,'[]') WITH &&));
CREATE TABLE journals(id uuid PRIMARY KEY,ref text NOT NULL UNIQUE,posting_date date NOT NULL,period_id uuid NOT NULL REFERENCES periods(id),description text NOT NULL,status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','posted')),created_by text NOT NULL,approved_by text,posted_by text,created_at timestamptz NOT NULL DEFAULT now(),posted_at timestamptz,reverses uuid UNIQUE REFERENCES journals(id));
CREATE TABLE journal_lines(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,journal_id uuid NOT NULL REFERENCES journals(id),account text NOT NULL REFERENCES accounts(code),detail text NOT NULL DEFAULT '',debit bigint NOT NULL CHECK(debit BETWEEN 0 AND 1000000000000000),credit bigint NOT NULL CHECK(credit BETWEEN 0 AND 1000000000000000),CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)));
CREATE INDEX journal_lines_account ON journal_lines(account,journal_id);
CREATE INDEX journal_lines_journal ON journal_lines(journal_id);
CREATE INDEX journal_date ON journals(posting_date,status);
CREATE FUNCTION guard_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p periods%ROWTYPE; balance numeric; n bigint;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'journal deletion is forbidden'; END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.status<>'draft' THEN RAISE EXCEPTION 'journal must begin draft'; END IF;
   RETURN NEW;
 END IF;
 IF OLD.status='posted' OR (NEW.id,NEW.ref,NEW.posting_date,NEW.period_id,NEW.description,NEW.created_by,NEW.created_at,NEW.reverses) IS DISTINCT FROM (OLD.id,OLD.ref,OLD.posting_date,OLD.period_id,OLD.description,OLD.created_by,OLD.created_at,OLD.reverses) THEN RAISE EXCEPTION 'immutable journal'; END IF;
 IF NOT ((OLD.status='draft' AND NEW.status='approved') OR (OLD.status='approved' AND NEW.status='posted' AND NEW.approved_by=OLD.approved_by)) THEN RAISE EXCEPTION 'invalid journal transition'; END IF;
 -- Lock the fiscal row for the posting transaction; a concurrent close waits.
 SELECT * INTO p FROM periods WHERE id=NEW.period_id FOR SHARE;
 IF NOT FOUND OR p.locked OR NEW.posting_date NOT BETWEEN p.starts AND p.ends THEN RAISE EXCEPTION 'closed or missing period'; END IF;
 SELECT COUNT(*),COALESCE(SUM(debit::numeric-credit::numeric),0) INTO n,balance FROM journal_lines WHERE journal_id=NEW.id;
 IF n<2 OR balance<>0 THEN RAISE EXCEPTION 'unbalanced journal'; END IF;
 IF NEW.approved_by IS NULL OR (NEW.status='posted' AND (NEW.posted_by IS NULL OR NEW.posted_at IS NULL)) THEN RAISE EXCEPTION 'approval or posting evidence missing'; END IF;
 IF EXISTS(SELECT 1 FROM journal_lines l JOIN accounts a ON a.code=l.account WHERE l.journal_id=NEW.id AND NOT a.active) THEN RAISE EXCEPTION 'inactive account'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER journal_guard BEFORE INSERT OR UPDATE OR DELETE ON journals FOR EACH ROW EXECUTE FUNCTION guard_journal();
CREATE FUNCTION guard_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'immutable journal line'; END IF;
 -- Serialize a line addition with approval/posting for the same journal.
 SELECT status INTO s FROM journals WHERE id=NEW.journal_id FOR UPDATE;
 IF s IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'closed journal'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER line_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION guard_line();
CREATE TABLE parties(id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN('customer','supplier')),external_ref text NOT NULL UNIQUE,name text NOT NULL);
CREATE TABLE products(id uuid PRIMARY KEY,store text NOT NULL,product_id bigint NOT NULL CHECK(product_id>0),variation_id bigint NOT NULL CHECK(variation_id>=0),sku text,name text NOT NULL,category text NOT NULL,quantity bigint NOT NULL DEFAULT 0 CHECK(quantity>=0),value bigint CHECK(value>=0),version bigint NOT NULL DEFAULT 0,UNIQUE(store,product_id,variation_id));
CREATE TABLE documents(id uuid PRIMARY KEY,kind text NOT NULL,external_ref text NOT NULL UNIQUE,document_date date NOT NULL,journal_id uuid NOT NULL UNIQUE REFERENCES journals(id),party_id uuid REFERENCES parties(id),evidence_ref text NOT NULL,at timestamptz NOT NULL DEFAULT now());
CREATE TABLE stock_movements(id uuid PRIMARY KEY,document_id uuid NOT NULL REFERENCES documents(id),product_id uuid NOT NULL REFERENCES products(id),quantity_delta bigint NOT NULL CHECK(quantity_delta<>0),value_delta bigint,expected_version bigint NOT NULL,quantity_after bigint NOT NULL CHECK(quantity_after>=0),value_after bigint CHECK(value_after>=0),at timestamptz NOT NULL DEFAULT now(),UNIQUE(document_id,product_id));
CREATE FUNCTION apply_stock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p products%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'immutable stock movement'; END IF;
 SELECT * INTO p FROM products WHERE id=NEW.product_id FOR UPDATE;
 IF NOT FOUND OR p.version<>NEW.expected_version OR p.quantity+NEW.quantity_delta<>NEW.quantity_after THEN RAISE EXCEPTION 'stale or invalid stock movement'; END IF;
 IF ((p.value IS NULL AND NEW.value_delta IS NULL AND NEW.value_after IS NULL) OR (p.value IS NOT NULL AND NEW.value_delta IS NOT NULL AND p.value+NEW.value_delta=NEW.value_after) OR (p.quantity=0 AND p.value IS NULL AND NEW.value_delta IS NOT NULL AND NEW.value_delta=NEW.value_after)) IS NOT TRUE THEN RAISE EXCEPTION 'invalid stock valuation'; END IF;
 UPDATE products SET quantity=NEW.quantity_after,value=NEW.value_after,version=version+1 WHERE id=NEW.product_id;
 RETURN NEW;
END $$;
CREATE TRIGGER stock_guard BEFORE INSERT OR UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION apply_stock();
CREATE TABLE source_events(id uuid PRIMARY KEY,source text NOT NULL,event_key text NOT NULL,business_key text NOT NULL,fingerprint text NOT NULL,payload jsonb NOT NULL,state text NOT NULL CHECK(state IN('received','review','historical','drafted','conflict')),received_at timestamptz NOT NULL DEFAULT now(),journal_id uuid REFERENCES journals(id),UNIQUE(source,event_key));
CREATE INDEX source_event_state ON source_events(state,received_at);
CREATE TABLE audit_records(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,at timestamptz NOT NULL DEFAULT now(),actor text NOT NULL,action text NOT NULL,reference text NOT NULL,evidence jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE FUNCTION immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable financial record'; END $$;
CREATE TRIGGER immutable_document BEFORE UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_records FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE VIEW trial_balance AS SELECT a.code,a.title,a.kind,COALESCE(SUM(l.debit) FILTER (WHERE j.status='posted'),0) debit,COALESCE(SUM(l.credit) FILTER (WHERE j.status='posted'),0) credit FROM accounts a LEFT JOIN journal_lines l ON l.account=a.code LEFT JOIN journals j ON j.id=l.journal_id GROUP BY a.code,a.title,a.kind;
INSERT INTO schema_migrations(version) VALUES(1);
COMMIT;
