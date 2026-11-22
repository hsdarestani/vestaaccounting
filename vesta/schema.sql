PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS account (
    code TEXT PRIMARY KEY, title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('asset','liability','equity','revenue','expense')),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS fiscal_period (
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, starts TEXT NOT NULL,
    ends TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
    CHECK(starts <= ends)
);
CREATE TRIGGER IF NOT EXISTS period_no_overlap BEFORE INSERT ON fiscal_period
WHEN EXISTS(SELECT 1 FROM fiscal_period WHERE starts <= NEW.ends AND ends >= NEW.starts)
BEGIN SELECT RAISE(ABORT, 'overlapping fiscal period'); END;
CREATE TABLE IF NOT EXISTS journal (
    id INTEGER PRIMARY KEY, source TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
    posting_date TEXT NOT NULL, document_date TEXT NOT NULL,
    description TEXT NOT NULL, period_id INTEGER NOT NULL REFERENCES fiscal_period(id),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','posted')),
    actor TEXT NOT NULL, approver TEXT, posted_by TEXT, posted_at TEXT,
    rule_version TEXT NOT NULL, reverses INTEGER UNIQUE REFERENCES journal(id)
);
CREATE TABLE IF NOT EXISTS journal_line (
    id INTEGER PRIMARY KEY, journal_id INTEGER NOT NULL REFERENCES journal(id),
    account_code TEXT NOT NULL REFERENCES account(code), detail TEXT NOT NULL DEFAULT '',
    memo TEXT NOT NULL DEFAULT '', debit INTEGER NOT NULL DEFAULT 0,
    credit INTEGER NOT NULL DEFAULT 0,
    CHECK(typeof(debit)='integer' AND typeof(credit)='integer'),
    CHECK(debit BETWEEN 0 AND 1000000000000000 AND credit BETWEEN 0 AND 1000000000000000),
    CHECK((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX IF NOT EXISTS line_account_idx ON journal_line(account_code, journal_id);
CREATE INDEX IF NOT EXISTS journal_date_idx ON journal(status, posting_date);
CREATE TRIGGER IF NOT EXISTS journal_initial_draft BEFORE INSERT ON journal
WHEN NEW.status <> 'draft' BEGIN SELECT RAISE(ABORT,'journal must start as draft'); END;
CREATE TRIGGER IF NOT EXISTS journal_immutable BEFORE UPDATE ON journal
WHEN OLD.status='posted' OR NEW.id<>OLD.id OR NEW.source<>OLD.source OR
 NEW.fingerprint<>OLD.fingerprint OR NEW.posting_date<>OLD.posting_date OR
 NEW.document_date<>OLD.document_date OR NEW.description<>OLD.description OR
 NEW.period_id<>OLD.period_id OR NEW.actor<>OLD.actor OR NEW.rule_version<>OLD.rule_version OR
 NEW.reverses IS NOT OLD.reverses
BEGIN SELECT RAISE(ABORT,'immutable journal'); END;
CREATE TRIGGER IF NOT EXISTS journal_transition BEFORE UPDATE ON journal
WHEN NOT ((OLD.status='draft' AND NEW.status='approved') OR (OLD.status='approved' AND NEW.status='posted'))
BEGIN SELECT RAISE(ABORT,'invalid journal transition'); END;
CREATE TRIGGER IF NOT EXISTS journal_check_post BEFORE UPDATE OF status ON journal
WHEN NEW.status IN ('approved','posted')
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fiscal_period WHERE id=NEW.period_id AND locked=0 AND NEW.posting_date BETWEEN starts AND ends) THEN RAISE(ABORT,'period closed or missing') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM journal_line WHERE journal_id=NEW.id)<2 OR
 (SELECT COALESCE(SUM(debit-credit),0) FROM journal_line WHERE journal_id=NEW.id)<>0 THEN RAISE(ABORT,'journal must balance') END;
 SELECT CASE WHEN NEW.approver IS NULL OR NEW.approver='' THEN RAISE(ABORT,'approval required') END;
 SELECT CASE WHEN NEW.status='posted' AND (NEW.posted_by IS NULL OR NEW.posted_at IS NULL) THEN RAISE(ABORT,'posting evidence required') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM journal_line l JOIN account a ON a.code=l.account_code WHERE l.journal_id=NEW.id AND a.active=0) THEN RAISE(ABORT,'inactive account') END;
END;
CREATE TRIGGER IF NOT EXISTS journal_no_delete BEFORE DELETE ON journal
BEGIN SELECT RAISE(ABORT,'journal deletion forbidden'); END;
CREATE TRIGGER IF NOT EXISTS lines_insert_guard BEFORE INSERT ON journal_line
WHEN (SELECT status FROM journal WHERE id=NEW.journal_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'journal not draft'); END;
CREATE TRIGGER IF NOT EXISTS lines_update_guard BEFORE UPDATE ON journal_line
BEGIN SELECT RAISE(ABORT,'journal lines immutable'); END;
CREATE TRIGGER IF NOT EXISTS lines_delete_guard BEFORE DELETE ON journal_line
BEGIN SELECT RAISE(ABORT,'journal lines immutable'); END;
CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL,
    action TEXT NOT NULL, object_ref TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT ''
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
CREATE TRIGGER IF NOT EXISTS period_dates_immutable BEFORE UPDATE ON fiscal_period
WHEN NEW.id<>OLD.id OR NEW.starts<>OLD.starts OR NEW.ends<>OLD.ends
BEGIN SELECT RAISE(ABORT,'period dates immutable'); END;
CREATE TRIGGER IF NOT EXISTS period_no_delete BEFORE DELETE ON fiscal_period BEGIN SELECT RAISE(ABORT,'period deletion forbidden'); END;
CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS external_event (
    id INTEGER PRIMARY KEY, source TEXT NOT NULL, event_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
    received_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'received'
      CHECK(status IN ('received','drafted','review','historical','duplicate','conflict')),
    reason TEXT, journal_id INTEGER REFERENCES journal(id), UNIQUE(source,event_key)
);
CREATE INDEX IF NOT EXISTS event_status_idx ON external_event(status,id);
CREATE TABLE IF NOT EXISTS event_conflict (
    id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES external_event(id),
    fingerprint TEXT NOT NULL, evidence TEXT NOT NULL, received_at TEXT NOT NULL,
    UNIQUE(event_id,fingerprint)
);
CREATE TRIGGER IF NOT EXISTS event_source_immutable BEFORE UPDATE ON external_event
WHEN NEW.source<>OLD.source OR NEW.event_key<>OLD.event_key OR NEW.kind<>OLD.kind OR NEW.payload<>OLD.payload OR NEW.fingerprint<>OLD.fingerprint OR NEW.received_at<>OLD.received_at
BEGIN SELECT RAISE(ABORT,'immutable event evidence'); END;
CREATE TRIGGER IF NOT EXISTS event_no_delete BEFORE DELETE ON external_event BEGIN SELECT RAISE(ABORT,'immutable event'); END;
CREATE TRIGGER IF NOT EXISTS conflict_no_update BEFORE UPDATE ON event_conflict BEGIN SELECT RAISE(ABORT,'immutable conflict'); END;
CREATE TRIGGER IF NOT EXISTS conflict_no_delete BEFORE DELETE ON event_conflict BEGIN SELECT RAISE(ABORT,'immutable conflict'); END;
CREATE TABLE IF NOT EXISTS product (
    id INTEGER PRIMARY KEY, store TEXT NOT NULL, product_id INTEGER NOT NULL CHECK(product_id>0),
    variation_id INTEGER NOT NULL DEFAULT 0 CHECK(variation_id>=0), sku TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL, UNIQUE(store,product_id,variation_id)
);
CREATE TABLE IF NOT EXISTS stock_movement (
    id INTEGER PRIMARY KEY, source TEXT NOT NULL UNIQUE, product INTEGER NOT NULL REFERENCES product(id),
    quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity<>0),
    evidence TEXT NOT NULL, at TEXT NOT NULL, cost_total INTEGER,
    CHECK(cost_total IS NULL OR (typeof(cost_total)='integer' AND cost_total>=0))
);
CREATE TRIGGER IF NOT EXISTS stock_no_update BEFORE UPDATE ON stock_movement BEGIN SELECT RAISE(ABORT,'immutable stock movement'); END;
CREATE TRIGGER IF NOT EXISTS stock_no_delete BEFORE DELETE ON stock_movement BEGIN SELECT RAISE(ABORT,'immutable stock movement'); END;
CREATE TABLE IF NOT EXISTS app_user (
    username TEXT PRIMARY KEY, password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner','accountant','operator','auditor','admin'))
);
CREATE TABLE IF NOT EXISTS session (
    token_hash TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES app_user(username),
    csrf TEXT NOT NULL, expires INTEGER NOT NULL
);
