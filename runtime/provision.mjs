import {poolFromEnv} from './pg.mjs';
import {provision} from './auth.mjs';
const pool=poolFromEnv();
try{const result=await provision(pool,process.env.ADMIN,process.env.PASS);console.log('Administrator provisioning:',result);}finally{await pool.end();}
