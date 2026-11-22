#!/usr/bin/env bash
# Isolated host installation only. No storefront paths, Docker networks, DNS or finance writes.
set -Eeuo pipefail
umask 077
ROOT=/srv/vesta-accounting
cd "$ROOT"
test -s release.tar.gz && test -s bootstrap.json
trap 'rm -f "$ROOT/bootstrap.json"' EXIT
exec 9>"$ROOT/.install.lock"
flock -n 9 || { echo 'Another accounting installation is running';exit 46; }
disk_floor=15000
if [[ "${1:-}" == '--preloaded-private-only' ]]; then
    # This path never pulls or unpacks images, publishes a port, or imports
    # source data. Reserve 1 GiB for PostgreSQL initialization and 11 GiB
    # for the existing host workloads. Check both backing filesystems.
    disk_floor=12288
fi
available=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)
disk=$(df -Pm "$ROOT" | awk 'NR==2{print $4}')
docker_root=$(docker info --format '{{.DockerRootDir}}')
test -d "$docker_root"
docker_disk=$(df -Pm "$docker_root" | awk 'NR==2{print $4}')
cores=$(nproc)
load=$(awk '{print $1}' /proc/loadavg)
if (( available < 3000 )); then echo 'Capacity gate failed: memory';exit 41;fi
if (( disk < disk_floor || docker_disk < disk_floor )); then echo 'Capacity gate failed: filesystem reserve';exit 41;fi
echo 'Private installation capacity gate passed'
awk -v l="$load" -v c="$cores" 'BEGIN{exit !(l<c*0.8)}' || { echo 'Capacity gate failed: CPU load'; exit 42; }
vmstat 1 3 | tail -1 | awk '{exit !($7==0&&$8==0)}' || { echo 'Capacity gate failed: active swap I/O';exit 43; }
mkdir -p release private backups
test ! -e "$ROOT/private/installed" || { echo 'Existing healthy installation; reviewed upgrade required'; exit 44; }
if docker ps -aq --filter label=com.docker.compose.project=vesta-accounting-source | grep -q .; then echo 'Partial container installation exists; inspect before retry'; exit 45; fi
tar -xzf release.tar.gz -C release
release_id=$(python3 -c 'import json; print(json.load(open("bootstrap.json"))["RELEASE"])')
[[ "$release_id" =~ ^[0-9a-f]{40}$ ]]
docker image inspect "vesta-accounting:$release_id" postgres:16-alpine nginx:1.27-alpine >/dev/null
cd release/runtime
python3 - "$ROOT/bootstrap.json" "$ROOT" <<'PY'
import json, pathlib, re, secrets, sys, os
p=pathlib.Path(sys.argv[1]); root=pathlib.Path(sys.argv[2]); d=json.loads(p.read_text())
for k in ('WOO_KEY','WOO_SECRET','WOO_WEBHOOK_SECRET'):
    if d.get(k) and not re.fullmatch(r'[A-Za-z0-9_\-=]{16,256}',d[k]): raise SystemExit('Invalid private integration configuration')
if not re.fullmatch(r'[0-9a-f]{40}',d.get('RELEASE','')): raise SystemExit('Invalid release identity')
env=root/'private'/'.private.env'; db=root/'private'/'.compose.env'
if env.exists()!=db.exists(): raise SystemExit('Existing private storage incomplete; no changes')
if not env.exists():
    pw=secrets.token_hex(32)
    env.write_text('\n'.join([f'DATABASE_URL=postgresql://accounting:{pw}@postgres:5432/vesta_accounting',f'IP_SALT={secrets.token_hex(32)}','MFA_REQUIRED=0','WOO_ORIGIN=https://vesta-cosmetics.ir/',f'WOO_KEY={d.get("WOO_KEY","")}',f'WOO_SECRET={d.get("WOO_SECRET","")}',f'WOO_WEBHOOK_SECRET={d.get("WOO_WEBHOOK_SECRET","")}',f'RELEASE={d["RELEASE"]}'])+'\n');db.write_text(f'POSTGRES_PASSWORD={pw}\nACCOUNTING_IMAGE=vesta-accounting:{d["RELEASE"]}\n')
else:
    # Resume only an unstarted installation, guarded above by project-container absence.
    # Preserve existing DB password and IP salt; no credentials are replaced.
    old=db.read_text()
    if not re.search(r'^ACCOUNTING_IMAGE=vesta-accounting:[0-9a-f]{40}$',old,re.M): raise SystemExit('Unexpected previous configuration')
    db.write_text(re.sub(r'^ACCOUNTING_IMAGE=vesta-accounting:[0-9a-f]{40}$',f'ACCOUNTING_IMAGE=vesta-accounting:{d["RELEASE"]}',old,flags=re.M))
    env.write_text(re.sub(r'^RELEASE=[0-9a-f]{40}$',f'RELEASE={d["RELEASE"]}',env.read_text(),flags=re.M))
for f in (env,db): os.chmod(f,0o600)
PY
if [[ ! -e .private.env ]];then ln -s "$ROOT/private/.private.env" .private.env;fi
docker compose --env-file "$ROOT/private/.compose.env" -f compose.yml up -d --wait --pull never postgres
docker compose --env-file "$ROOT/private/.compose.env" -f compose.yml run --rm app node migrate.mjs
python3 - "$ROOT/bootstrap.json" "$ROOT/private/.compose.env" <<'PY'
import json, os, subprocess, sys
d=json.load(open(sys.argv[1]));e=dict(os.environ,ADMIN=d['ADMIN'],PASS=d['PASS'])
subprocess.run(['docker','compose','--env-file',sys.argv[2],'-f','compose.yml','run','--rm','-e','ADMIN','-e','PASS','app','node','provision.mjs'],env=e,check=True)
PY
docker compose --env-file "$ROOT/private/.compose.env" -f compose.yml up -d --wait --pull never app proxy
if [[ "${1:-}" == '--preloaded-private-only' ]] && (( $(df -Pm "$docker_root" | awk 'NR==2{print $4}') < 11264 )); then
    docker compose --env-file "$ROOT/private/.compose.env" -f compose.yml stop proxy app postgres
    echo 'Retained filesystem reserve below minimum; accounting services stopped without removing data'; exit 47
fi
curl -fsS --max-time 10 http://127.0.0.1:18089/health | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["database"]=="postgresql" and d["posting_authorized"] is False;print("Isolated PostgreSQL runtime is healthy")'
python3 - "$ROOT/bootstrap.json" <<'PY'
import json,sys,urllib.request
d=json.load(open(sys.argv[1]))
body=json.dumps({'username':d['ADMIN'],'password':d['PASS']}).encode()
req=urllib.request.Request('http://127.0.0.1:18089/api/login',data=body,headers={'Content-Type':'application/json'},method='POST')
with urllib.request.urlopen(req,timeout=15) as r:
    user=json.load(r); assert user['role']=='owner' and user['username']==d['ADMIN']; cookie=r.headers['Set-Cookie'].split(';')[0]
logout=urllib.request.Request('http://127.0.0.1:18089/api/logout',data=b'{}',headers={'Content-Type':'application/json','Cookie':cookie,'X-CSRF-Token':user['csrf']},method='POST')
with urllib.request.urlopen(logout,timeout=15) as r: assert r.status==200
print('private_admin_login_verified=true')
PY
# Explicit source synchronization is authorized, but only start after separate release gate.
rm -f "$ROOT/release.tar.gz"
touch "$ROOT/private/installed"
echo 'Private installation healthy; no public routing or source import enabled.'
