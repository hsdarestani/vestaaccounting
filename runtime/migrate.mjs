import {readFile} from 'node:fs/promises';
import {poolFromEnv} from './pg.mjs';
const db=poolFromEnv();
try{await db.query(await readFile(new URL('001_runtime.sql',import.meta.url),'utf8'));console.log('PostgreSQL runtime migration verified');}finally{await db.end();}
