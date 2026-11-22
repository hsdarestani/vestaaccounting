#!/usr/bin/env bash
# Adds only the accounting virtual hosts to the already running TLS proxy.
set -Eeuo pipefail
umask 077
ROOT=/srv/vesta-accounting
legacy=/srv/vestacutella/repo/infra/nginx.conf
certs=/srv/vestacutella/runtime/certs/vesta-accounting
nginx=vc-nginx
network=vestacutella-backend
cd "$ROOT/private"
test -f installed
exec 9>"$ROOT/.install.lock"
flock -n 9
test -f "$legacy" && test ! -L "$legacy"
docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/nginx/nginx.conf"}}{{.Source}}{{end}}{{end}}' "$nginx" | grep -Fxq "$legacy"
docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/nginx/certs"}}{{.Source}}{{end}}{{end}}' "$nginx" | grep -Fxq /srv/vestacutella/runtime/certs
openssl x509 -in origin-tls/origin.pem -noout -checkhost hesab.vesta-cosmetics.ir | grep -Fq 'does match certificate'
openssl x509 -in origin-tls/origin.pem -noout -checkhost hesab-stage.vesta-cosmetics.ir | grep -Fq 'does match certificate'
diff <(openssl x509 -in origin-tls/origin.pem -pubkey -noout) <(openssl pkey -in origin-tls/origin.key -pubout) >/dev/null
openssl verify -CAfile origin-tls/origin-ca.pem origin-tls/origin.pem >/dev/null
install -d -m 700 "$certs"
install -m 600 -t "$certs" origin-tls/origin.{pem,key}
read -r nginx_ip gateway < <(docker inspect --format '{{with index .NetworkSettings.Networks "vestacutella-backend"}}{{.IPAddress}} {{.Gateway}}{{end}}' "$nginx")
python3 - "$gateway" "$nginx_ip" <<'PY'
from ipaddress import IPv4Address
import sys
assert all(IPv4Address(x).is_private for x in sys.argv[1:])
PY
sed "1i allow $gateway;" origin-tls/edge-acl.conf > "$certs/edge-acl.conf"
snapshot=$(mktemp -d "$ROOT/backups/origin.XXXXXXXX")
cp -- "$legacy" "$snapshot/nginx.conf"
attached=0
changed=0
rollback(){
    if [[ "$changed" == 1 ]]; then
      dd if="$snapshot/nginx.conf" of="$legacy" status=none
      docker exec "$nginx" nginx -t && docker exec "$nginx" nginx -s reload
    fi
    if [[ "$attached" == 1 ]]; then
      compose_proxy up -d --no-deps --pull never --wait --force-recreate proxy
    fi
}
compose_proxy(){ docker compose --env-file "$ROOT/private/.compose.env" -f "$ROOT/release/runtime/compose.yml" "$@"; }
trap 'code=$?;trap - ERR;rollback || echo accounting_tls_rollback_needs_inspection;exit "$code"' ERR
if [[ ! -f compose.origin.active.yml ]]; then
    docker network inspect "$network" >/dev/null
    attached=1
    compose_proxy -f "$ROOT/private/compose.origin.yml" up -d --no-deps --pull never --wait --force-recreate proxy
fi
python3 - "$snapshot/nginx.conf" accounting-origin.nginx "$certs/nginx-staged.conf" <<'PY'
import pathlib,re,sys
old,block,out=(pathlib.Path(x) for x in sys.argv[1:])
text=old.read_text()
if 'BEGIN VESTA ACCOUNTING HTTPS ORIGIN' in text:
    text,n=re.subn(r'# BEGIN VESTA ACCOUNTING HTTPS ORIGIN\n.*?# END VESTA ACCOUNTING HTTPS ORIGIN',block.read_text().strip(),text,flags=re.S)
    assert n==1
else:
    assert not re.search(r'\bserver_name\s+[^;]*\bhesab(?:-stage)?\.vesta-cosmetics\.ir\b',text)
    assert text.rstrip().endswith('}')
    final=text.rfind('}')
    text=text[:final]+block.read_text()+'\n'+text[final:]
out.write_text(text)
PY
docker exec "$nginx" nginx -t -c /etc/nginx/certs/vesta-accounting/nginx-staged.conf
cmp -s "$legacy" "$snapshot/nginx.conf"
changed=1
# The live file is an inode bind mount; preserve the inode and reload gracefully.
dd if="$certs/nginx-staged.conf" of="$legacy" status=none
docker exec "$nginx" nginx -t
docker exec "$nginx" nginx -s reload
verified=0
for delay in 1 2 3 4; do
    if curl --noproxy '*' --cacert origin-tls/origin-ca.pem --resolve "hesab-stage.vesta-cosmetics.ir:443:$nginx_ip" \
        -fsS --max-time 6 https://hesab-stage.vesta-cosmetics.ir/health |
        python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["database"]=="postgresql" and d["posting_authorized"] is False and d["store_writes"] is False' 2>/dev/null; then
        verified=1;break
    fi
    sleep "$delay"
done
test "$verified" = 1
install -m 600 compose.origin.yml compose.origin.active.yml
trap - ERR
echo accounting_tls_origin_verified=true
