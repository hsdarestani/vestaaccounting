"""Local evaluation authentication: no default user or production credentials."""
import hashlib
import hmac
import secrets
import time
from .ledger import RuleError

ROLES={'owner','accountant','operator','auditor','admin'}

def password_hash(password,salt=None):
    if not isinstance(password,str) or not 12<=len(password)<=256:
        raise RuleError('password length must be 12–256 characters')
    salt=salt or secrets.token_hex(16)
    key=hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=2**14,r=8,p=1,dklen=32)
    return 'scrypt$'+salt+'$'+key.hex()

def verify_password(password,stored):
    try:
        _,salt,_=stored.split('$')
        return hmac.compare_digest(password_hash(password,salt),stored)
    except (ValueError,TypeError):
        return False

def add_user(ledger,username,password,role):
    if not isinstance(username,str) or not 3<=len(username)<=80 or not username.isascii() or not username.replace('_','').replace('-','').isalnum() or role not in ROLES:
        raise RuleError('invalid username or role')
    with ledger.transaction() as c:
        c.execute('INSERT INTO app_user VALUES (?,?,?)',(username,password_hash(password),role))
        ledger.audit(c,'local-administrator','user.create',username,role)

def login(ledger,username,password):
    with ledger.transaction() as c:
        user=c.execute('SELECT * FROM app_user WHERE username=?',(username,)).fetchone()
        # Similar computational work for unknown usernames.
        stored=user['password_hash'] if user else 'scrypt$'+'00'*16+'$'+'00'*32
        if not verify_password(password,stored) or not user: return None
        token=secrets.token_urlsafe(32); csrf=secrets.token_urlsafe(32)
        c.execute('DELETE FROM session WHERE expires<=?',(int(time.time()),))
        c.execute('INSERT INTO session VALUES (?,?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),username,csrf,int(time.time())+8*3600))
        ledger.audit(c,username,'session.login',username)
        return {'token':token,'csrf':csrf,'username':username,'role':user['role']}

def session(ledger,token):
    if not token or not isinstance(token,str) or len(token)>128: return None
    key=hashlib.sha256(token.encode()).hexdigest()
    with ledger.read() as c:
        row=c.execute('SELECT s.username,s.csrf,u.role FROM session s JOIN app_user u ON s.username=u.username WHERE s.token_hash=? AND s.expires>?',(key,int(time.time()))).fetchone()
        return dict(row) if row else None

def logout(ledger,token):
    if token:
        with ledger.transaction() as c:
            c.execute('DELETE FROM session WHERE token_hash=?',(hashlib.sha256(token.encode()).hexdigest(),))
