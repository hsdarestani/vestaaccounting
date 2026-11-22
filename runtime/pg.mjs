import pg from 'pg';
const {Pool,types}=pg;
// JSON/worker API keeps integer Toman. A value beyond safe JS range fails closed.
function exact(v){const n=Number(v);if(!Number.isSafeInteger(n))throw Error('integer exceeds safe range');return n;}
types.setTypeParser(20,exact);types.setTypeParser(1700,exact);types.setTypeParser(1082,v=>v);types.setTypeParser(1184,v=>new Date(v).toISOString());
function translate(sql){let quoted=false,i=0,result='';for(let n=0;n<sql.length;n++){const c=sql[n];if(c==="'"){result+=c;if(quoted&&sql[n+1]==="'"){result+="'";n++;}else quoted=!quoted;continue;}if(c==='?'&&!quoted)result+='$'+(++i);else result+=c;}if(result.includes('login_limits'))result=result.replace(/\bwindow\b/g,'"window"');return result.replace(/(\$\d+) IS NULL/g,'CAST($1 AS text) IS NULL');}
class Prepared{constructor(db,sql,args=[]){this.db=db;this.sql=translate(sql);this.args=args;}bind(...args){const p=Object.create(Prepared.prototype);p.db=this.db;p.sql=this.sql;p.args=args;return p;}async all(){return {results:(await this.db.query(this.sql,this.args)).rows};}async first(){return (await this.all()).results[0]||null;}async run(){return {success:true,changes:(await this.db.query(this.sql,this.args)).rowCount};}}
export class PgBinding{
 constructor(pool){this.pool=pool;}
 prepare(sql){return new Prepared(this.pool,sql);}
 async batch(stmts){const conn=await this.pool.connect();try{await conn.query('BEGIN');const results=[];for(const s of stmts){const r=await conn.query(s.sql,s.args);results.push({results:r.rows,changes:r.rowCount});}await conn.query('COMMIT');return results;}catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}}
}
export const poolFromEnv=()=>new Pool({connectionString:process.env.DATABASE_URL,max:4,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:10000,application_name:'vesta-accounting'});
