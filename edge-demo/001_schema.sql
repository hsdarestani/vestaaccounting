-- Independent synthetic evaluation database. Never bind this to a real store.
CREATE TABLE IF NOT EXISTS accounts(code TEXT PRIMARY KEY,title TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('asset','liability','equity','revenue','expense')));
CREATE TABLE IF NOT EXISTS periods(id TEXT PRIMARY KEY,title TEXT NOT NULL,starts TEXT NOT NULL,ends TEXT NOT NULL,locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN(0,1)),CHECK(starts<=ends));
CREATE TRIGGER IF NOT EXISTS no_period_overlap BEFORE INSERT ON periods WHEN EXISTS(SELECT 1 FROM periods WHERE starts<=NEW.ends AND ends>=NEW.starts) BEGIN SELECT RAISE(ABORT,'overlapping period'); END;
CREATE TABLE IF NOT EXISTS journals(id TEXT PRIMARY KEY,ref TEXT NOT NULL UNIQUE,date TEXT NOT NULL,period TEXT NOT NULL REFERENCES periods(id),description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','posted')),actor TEXT NOT NULL,approved_by TEXT,posted_by TEXT,reverses TEXT UNIQUE REFERENCES journals(id),at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lines(id INTEGER PRIMARY KEY,journal TEXT NOT NULL REFERENCES journals(id),account TEXT NOT NULL REFERENCES accounts(code),detail TEXT NOT NULL DEFAULT '',debit INTEGER NOT NULL CHECK(typeof(debit)='integer' AND debit BETWEEN 0 AND 1000000000000),credit INTEGER NOT NULL CHECK(typeof(credit)='integer' AND credit BETWEEN 0 AND 1000000000000),CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)));
CREATE INDEX IF NOT EXISTS idx_lines_account ON lines(account,journal);
CREATE INDEX IF NOT EXISTS idx_lines_journal ON lines(journal);
CREATE INDEX IF NOT EXISTS idx_journals_date ON journals(date,status);
CREATE TRIGGER IF NOT EXISTS journal_new BEFORE INSERT ON journals WHEN NEW.status<>'draft' BEGIN SELECT RAISE(ABORT,'journal must begin draft'); END;
CREATE TRIGGER IF NOT EXISTS journal_guard BEFORE UPDATE ON journals BEGIN
 SELECT CASE WHEN OLD.status='posted' OR NEW.id<>OLD.id OR NEW.ref<>OLD.ref OR NEW.date<>OLD.date OR NEW.period<>OLD.period OR NEW.description<>OLD.description OR NEW.actor<>OLD.actor OR NEW.reverses IS NOT OLD.reverses OR NEW.at<>OLD.at THEN RAISE(ABORT,'immutable journal') END;
 SELECT CASE WHEN NOT ((OLD.status='draft' AND NEW.status='approved') OR (OLD.status='approved' AND NEW.status='posted' AND NEW.approved_by=OLD.approved_by)) THEN RAISE(ABORT,'invalid transition') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM periods WHERE id=NEW.period AND locked=0 AND NEW.date BETWEEN starts AND ends) THEN RAISE(ABORT,'period locked') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM lines WHERE journal=NEW.id)<2 OR (SELECT COALESCE(SUM(debit-credit),0) FROM lines WHERE journal=NEW.id)<>0 THEN RAISE(ABORT,'unbalanced journal') END;
 SELECT CASE WHEN NEW.approved_by IS NULL OR (NEW.status='posted' AND NEW.posted_by IS NULL) THEN RAISE(ABORT,'approval missing') END;
END;
CREATE TRIGGER IF NOT EXISTS journal_delete BEFORE DELETE ON journals BEGIN SELECT RAISE(ABORT,'immutable journal'); END;
CREATE TRIGGER IF NOT EXISTS line_insert BEFORE INSERT ON lines WHEN (SELECT status FROM journals WHERE id=NEW.journal)<>'draft' BEGIN SELECT RAISE(ABORT,'closed journal'); END;
CREATE TRIGGER IF NOT EXISTS line_update BEFORE UPDATE ON lines BEGIN SELECT RAISE(ABORT,'immutable line'); END;
CREATE TRIGGER IF NOT EXISTS line_delete BEFORE DELETE ON lines BEGIN SELECT RAISE(ABORT,'immutable line'); END;
CREATE TABLE IF NOT EXISTS parties(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN('customer','supplier')),name TEXT NOT NULL,ref TEXT NOT NULL UNIQUE,notes TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,product_id INTEGER NOT NULL,variation_id INTEGER NOT NULL,name TEXT NOT NULL,variant TEXT NOT NULL DEFAULT '',sku TEXT NOT NULL UNIQUE,category TEXT NOT NULL,quantity INTEGER NOT NULL DEFAULT 0 CHECK(typeof(quantity)='integer' AND quantity>=0),value INTEGER CHECK(value IS NULL OR (typeof(value)='integer' AND value>=0)),version INTEGER NOT NULL DEFAULT 0,UNIQUE(product_id,variation_id));
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,kind TEXT NOT NULL,ref TEXT NOT NULL UNIQUE,date TEXT NOT NULL,party TEXT REFERENCES parties(id),product TEXT REFERENCES products(id),quantity INTEGER NOT NULL DEFAULT 0,subtotal INTEGER NOT NULL DEFAULT 0,discount INTEGER NOT NULL DEFAULT 0,shipping INTEGER NOT NULL DEFAULT 0,tax INTEGER NOT NULL DEFAULT 0,gross INTEGER NOT NULL DEFAULT 0,cost INTEGER,channel TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'posted',journal TEXT NOT NULL UNIQUE REFERENCES journals(id),note TEXT NOT NULL DEFAULT '',related TEXT UNIQUE REFERENCES documents(id));
CREATE INDEX IF NOT EXISTS idx_docs_kind_date ON documents(kind,date);
CREATE INDEX IF NOT EXISTS idx_docs_party ON documents(party);
CREATE TRIGGER IF NOT EXISTS settlement_guard BEFORE INSERT ON documents WHEN NEW.kind='settlement' BEGIN
 SELECT CASE WHEN (SELECT COALESCE(SUM(l.debit-l.credit),0) FROM lines l JOIN journals j ON j.id=l.journal WHERE j.status='posted' AND l.account=NEW.channel)<0 THEN RAISE(ABORT,'settlement exceeds clearing balance') END;
END;
CREATE TABLE IF NOT EXISTS movements(id TEXT PRIMARY KEY,doc TEXT NOT NULL UNIQUE REFERENCES documents(id),product TEXT NOT NULL REFERENCES products(id),date TEXT NOT NULL,kind TEXT NOT NULL,delta INTEGER NOT NULL CHECK(typeof(delta)='integer' AND delta<>0),value_delta INTEGER,expected_version INTEGER NOT NULL,qty_after INTEGER NOT NULL CHECK(qty_after>=0),value_after INTEGER CHECK(value_after IS NULL OR value_after>=0));
CREATE INDEX IF NOT EXISTS idx_moves_product ON movements(product,date);
CREATE TRIGGER IF NOT EXISTS movement_guard BEFORE INSERT ON movements BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM products p WHERE p.id=NEW.product AND p.version=NEW.expected_version AND p.quantity+NEW.delta=NEW.qty_after AND ((p.value IS NULL AND NEW.value_delta IS NULL AND NEW.value_after IS NULL) OR (p.value IS NOT NULL AND NEW.value_delta IS NOT NULL AND p.value+NEW.value_delta=NEW.value_after) OR (p.quantity=0 AND p.value IS NULL AND NEW.value_delta IS NOT NULL AND NEW.value_after=NEW.value_delta))) THEN RAISE(ABORT,'inventory stale or valuation inconsistent') END;
END;
CREATE TRIGGER IF NOT EXISTS movement_apply AFTER INSERT ON movements BEGIN UPDATE products SET quantity=NEW.qty_after,value=NEW.value_after,version=version+1 WHERE id=NEW.product; END;
CREATE TRIGGER IF NOT EXISTS movement_update BEFORE UPDATE ON movements BEGIN SELECT RAISE(ABORT,'immutable movement'); END;
CREATE TRIGGER IF NOT EXISTS movement_delete BEFORE DELETE ON movements BEGIN SELECT RAISE(ABORT,'immutable movement'); END;
CREATE TRIGGER IF NOT EXISTS doc_no_update BEFORE UPDATE ON documents BEGIN SELECT RAISE(ABORT,'immutable document'); END;
CREATE TRIGGER IF NOT EXISTS doc_no_delete BEFORE DELETE ON documents BEGIN SELECT RAISE(ABORT,'immutable document'); END;
CREATE TABLE IF NOT EXISTS exceptions(id TEXT PRIMARY KEY,kind TEXT NOT NULL,ref TEXT NOT NULL UNIQUE,expected INTEGER,observed INTEGER,description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','review','resolved')),resolution TEXT,at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS opening_refs(id TEXT PRIMARY KEY,product TEXT NOT NULL UNIQUE REFERENCES products(id),quantity INTEGER NOT NULL CHECK(quantity>=0),evidence TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,ref TEXT NOT NULL,description TEXT NOT NULL DEFAULT '');
CREATE TRIGGER IF NOT EXISTS audit_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
CREATE TRIGGER IF NOT EXISTS audit_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL,actor TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN('owner','viewer')));
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires);
CREATE TABLE IF NOT EXISTS login_limits(ip_hash TEXT PRIMARY KEY,window INTEGER NOT NULL,n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS migrations(version TEXT PRIMARY KEY,applied TEXT NOT NULL);
INSERT OR IGNORE INTO migrations VALUES('001',CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO accounts VALUES
('1010','بانک اصلی','asset'),('1011','صندوق','asset'),('1100','حساب‌های دریافتنی','asset'),('1200','موجودی کالا','asset'),('1310','درگاه زیبال','asset'),('1320','اسنپ‌پی','asset'),('1330','تروپی','asset'),('1340','دیجی‌پی','asset'),('1390','درگاه دیگر','asset'),('2010','حساب‌های پرداختنی','liability'),('2020','پیش‌دریافت مشتری','liability'),('2100','مالیات پرداختنی','liability'),('3010','سرمایه و افتتاحیه','equity'),('4010','فروش کالا','revenue'),('4020','درآمد ارسال','revenue'),('4030','تخفیفات فروش','revenue'),('4040','برگشت از فروش','revenue'),('5010','بهای تمام‌شده کالای فروش‌رفته','expense'),('5020','کارمزد درگاه','expense'),('5030','هزینه ارسال','expense'),('5040','تبلیغات','expense'),('5050','ضایعات و کسری','expense'),('5090','سایر هزینه‌ها','expense');
