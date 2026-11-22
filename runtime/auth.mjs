import {randomBytes,scrypt as scryptCb,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCb),params={N:32768,r:8,p:1,maxmem:96*1024*1024};
export async function passwordHash(password,salt=randomBytes(24)){
 if(typeof password!=='string'||password.length<12||password.length>256)throw Error('administrator password must be 12–256 characters');
 const key=await scrypt(password,salt,64,params);return `scrypt$32768$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function verifyPassword(password,stored){try{const [type,n,r,p,s,k]=stored.split('$');if(type!=='scrypt'||n!=='32768'||r!=='8'||p!=='1')return false;const expected=Buffer.from(k,'base64url');if(expected.length!==64)return false;const actual=await scrypt(password,Buffer.from(s,'base64url'),64,params);return timingSafeEqual(actual,expected);}catch{return false;}}
const dummyHash=`scrypt$32768$8$1$${randomBytes(24).toString('base64url')}$${randomBytes(64).toString('base64url')}`;
export function authenticator(pool){return async(username,password)=>{const row=(await pool.query('SELECT password_hash,role,enabled FROM app_users WHERE username=$1',[username])).rows[0];const valid=await verifyPassword(password,row?.password_hash||dummyHash);return valid&&row?.enabled?{role:row.role}:null;};}
export async function provision(pool,username,password){if(typeof username!=='string'||!username.trim()||username.length>128)throw Error('invalid administrator identity');const existing=(await pool.query('SELECT username,role,password_hash FROM app_users WHERE username=$1',[username])).rows[0];if(existing){if(existing.role!=='owner'||!await verifyPassword(password,existing.password_hash))throw Error('existing identity differs; no replacement');return 'preserved';}const count=(await pool.query("SELECT COUNT(*) n FROM app_users WHERE role='owner'")).rows[0].n;if(Number(count)>0)throw Error('different owner already exists; no replacement');const hash=await passwordHash(password);await pool.query('INSERT INTO app_users(username,password_hash,role) VALUES($1,$2,$3)',[username,hash,'owner']);return 'created';}
