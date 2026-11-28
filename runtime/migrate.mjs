import {readFile} from 'node:fs/promises';
import {poolFromEnv} from './pg.mjs';
const db=poolFromEnv();
const migrations=['001_runtime','002_cutover_plan','003_opening_evidence','004_opening_input_review','005_gateway_settlement_evidence','006_opening_balance_bridge','007_opening_stock_reconciliation','008_woo_revenue_drafts','009_inventory_cost_evidence','010_operating_expense_evidence','011_purchase_invoice_evidence','012_supplier_payment_evidence','013_refund_review','014_expense_categories','015_bank_movement_evidence','016_bank_statements'];
try{for(const name of migrations)await db.query(await readFile(new URL(name+'.sql',import.meta.url),'utf8'));console.log('PostgreSQL runtime migration verified');}finally{await db.end();}
