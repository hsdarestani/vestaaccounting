import {readFile} from 'node:fs/promises';
import {poolFromEnv} from './pg.mjs';
const db=poolFromEnv();
try{await db.query(await readFile(new URL('001_runtime.sql',import.meta.url),'utf8'));
await db.query(await readFile(new URL('002_cutover_plan.sql',import.meta.url),'utf8'));
await db.query(await readFile(new URL('003_opening_evidence.sql',import.meta.url),'utf8'));
await db.query(await readFile(new URL('004_opening_input_review.sql',import.meta.url),'utf8'));await db.query(await readFile(new URL('005_gateway_settlement_evidence.sql',import.meta.url),'utf8'));await db.query(await readFile(new URL('006_opening_balance_bridge.sql',import.meta.url),'utf8'));await db.query(await readFile(new URL('007_opening_stock_reconciliation.sql',import.meta.url),'utf8'));console.log('PostgreSQL runtime migration verified');}finally{await db.end();}
