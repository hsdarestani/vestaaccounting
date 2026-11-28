BEGIN;
CREATE TABLE IF NOT EXISTS expense_categories (
 id text PRIMARY KEY,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
 account text NOT NULL REFERENCES accounts(code) CHECK(account IN ('5030','5040','5090')),
 active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_name_unique ON expense_categories(lower(trim(name)));
INSERT INTO expense_categories(id,name,account) VALUES
 ('rent','اجاره','5090'),('salary','حقوق کارکنان','5090'),('benefits','پاداش و مزایا','5090'),
 ('advertising','تبلیغات','5040'),('instagram','بازاریابی اینستاگرام','5040'),('packaging','بسته‌بندی','5090'),
 ('shipping','ارسال','5030'),('utilities','آب، برق و گاز','5090'),('telecom','اینترنت و تلفن','5090'),
 ('transport','حمل‌ونقل','5090'),('software','اشتراک نرم‌افزار','5090'),('supplies','تجهیزات مصرفی','5090'),
 ('maintenance','تعمیر و نگهداری','5090'),('bank_fees','هزینه بانکی (غیر از کارمزد درگاه)','5090'),
 ('professional','خدمات تخصصی','5090'),('tax_expense','مالیات شناسایی‌شده به عنوان هزینه','5090'),('misc','سایر هزینه‌ها','5090')
 ON CONFLICT DO NOTHING;
ALTER TABLE operating_expense_evidence ADD COLUMN IF NOT EXISTS category_id text REFERENCES expense_categories(id);
CREATE INDEX IF NOT EXISTS expense_evidence_category_idx ON operating_expense_evidence(category_id,expense_date);
INSERT INTO migrations(version,applied) VALUES('014',now()::text) ON CONFLICT DO NOTHING;
COMMIT;
