BEGIN;
CREATE TABLE IF NOT EXISTS purchase_invoice_terms (
 invoice_id text PRIMARY KEY REFERENCES purchase_invoice_evidence(id),payment_mode text NOT NULL CHECK(payment_mode IN('credit','cash','mixed')),
 due_date date,initial_payment_id text UNIQUE REFERENCES supplier_payment_evidence(id),initial_paid_toman numeric(16,2) NOT NULL DEFAULT 0 CHECK(initial_paid_toman>=0),
 CHECK((payment_mode='credit' AND initial_payment_id IS NULL AND initial_paid_toman=0) OR (payment_mode IN('cash','mixed') AND initial_payment_id IS NOT NULL AND initial_paid_toman>0)),
 CHECK(payment_mode<>'cash' OR due_date IS NULL)
);
DROP TRIGGER IF EXISTS purchase_invoice_terms_guard ON purchase_invoice_terms;
CREATE TRIGGER purchase_invoice_terms_guard BEFORE UPDATE OR DELETE ON purchase_invoice_terms FOR EACH ROW EXECUTE FUNCTION runtime_immutable();
INSERT INTO migrations(version,applied) VALUES('019',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
