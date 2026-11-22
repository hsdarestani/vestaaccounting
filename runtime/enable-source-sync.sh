#!/usr/bin/env bash
# Provisions an isolated WooCommerce read-only API identity. It never reads
# storefront DB configuration, modifies stock, or changes commercial records.
set -Eeuo pipefail
umask 077
ROOT=/srv/vesta-accounting
cd "$ROOT/private"
test -f installed
exec 9>"$ROOT/.install.lock"
flock -n 9
docker inspect --format '{{.State.Running}}' vc-vesta | grep -Fxq true
if [[ ! -s .woo.env ]]; then
    # Persist the process output directly to protected host storage; never echo it.
    docker exec -u www-data -i vc-vesta php -d display_errors=0 -l < provision-woo-readonly.php >/dev/null
    test ! -e woo-key-provision.json || { echo 'Existing interrupted credential provisioning; preserving results'; exit 44; }
    docker exec -u www-data -i vc-vesta php -d display_errors=0 -d log_errors=0 < provision-woo-readonly.php > woo-key-provision.json 2>/dev/null
    python3 - <<'PY'
import json, pathlib, re
private=pathlib.Path('.')
keys=json.loads((private/'woo-key-provision.json').read_text())
assert re.fullmatch(r'ck_[0-9a-f]{40,64}',keys['key'])
assert re.fullmatch(r'cs_[0-9a-f]{40,64}',keys['secret'])
with (private/'.woo.env').open('x') as dest:
    dest.write('WOO_KEY='+keys['key']+'\nWOO_SECRET='+keys['secret']+'\n')
(private/'woo-key-provision.json').unlink()
PY
else
    docker exec -u www-data -e VESTA_READONLY_CHECK_ONLY=1 -i vc-vesta php -d display_errors=0 -d log_errors=0 < provision-woo-readonly.php >/dev/null 2>&1
fi
cd "$ROOT/release/runtime"
compose() { docker compose --env-file "$ROOT/private/.compose.env" -f compose.yml -f "$ROOT/private/compose.source-sync.yml" --profile source-sync "$@"; }
compose run -T --rm --no-deps sync node --input-type=module -e '
import {WooSource} from "./source.mjs";
const woo=new WooSource({origin:process.env.WOO_ORIGIN,key:process.env.WOO_KEY,secret:process.env.WOO_SECRET,pageSize:1});
for (const kind of ["products","orders","customers","categories","coupons"]) {
  try { await woo.page(kind,1); }
  catch(e) { console.error("woo_read_preflight="+kind+":"+(/^woo_http_\d+$/.test(e.message)?e.message:"unavailable"));process.exit(1); }
}
console.log("woo_readonly_access_verified=true");
'
compose up -d --no-deps --pull never sync
echo woo_sync_worker_started=true
