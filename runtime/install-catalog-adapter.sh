#!/usr/bin/env bash
# Installs one isolated read-only WooCommerce REST registration. No restart.
set -Eeuo pipefail
umask 077
ROOT=/srv/vesta-accounting
cd "$ROOT/private"
test -f installed && test -s .woo.env || { echo catalog_precheck_no_accounting_credentials; exit 40; }
exec 9>"$ROOT/.install.lock"
flock -w 30 9 || { echo catalog_precheck_accounting_lock_unavailable; exit 41; }
store=/srv/vestacutella/runtime/vesta
actual=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/www/html"}}{{.Source}}{{end}}{{end}}' vc-vesta)
test -n "$actual" && test "$(realpath -e "$actual")" = "$(realpath -e "$store")" || { echo catalog_precheck_wrong_wordpress_mount; exit 42; }
plugin_dir=$(realpath -e "$store/wp-content/mu-plugins")
test -d "$plugin_dir" && [[ "$plugin_dir" == "$(realpath -e "$store")"/wp-content/mu-plugins ]] || { echo catalog_precheck_wrong_plugin_mount; exit 43; }
dest="$plugin_dir/vesta-accounting-catalog.php"
docker exec -u www-data -i vc-vesta php -d display_errors=0 -l < vesta-accounting-catalog.php || { echo catalog_precheck_php_lint_failed; exit 44; }
echo catalog_filesystem_and_php_validation_passed=true
installed=0
trap 'status=$?; if [[ "$installed" == 1 ]]; then mv -- "$dest" "$ROOT/private/catalog-adapter-rejected.php"; fi; exit "$status"' ERR
if [[ -f "$dest" ]]; then
    cmp -s "$dest" vesta-accounting-catalog.php || { echo catalog_precheck_existing_adapter_differs; exit 45; }
else
    next=$(mktemp "$plugin_dir/.vesta-accounting-catalog.XXXXXXXX")
    install -m 644 vesta-accounting-catalog.php "$next"
    mv -T -- "$next" "$dest"
    installed=1
fi
cd "$ROOT/release/runtime"
echo catalog_secure_connection_preflight_started=true
docker compose --env-file "$ROOT/private/.compose.env" -f compose.yml -f "$ROOT/private/compose.source-sync.yml" --profile source-sync +  run -T --no-deps --rm sync node --input-type=module <<'NODE'
const url='https://vesta-cosmetics.ir/wp-json/wc/v3/vesta-accounting/catalog?per_page=1&_fields=id';
try{
 const get=(headers)=>fetch(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(20000)});
 const denied=await get({Accept:'application/json'});if(![401,403].includes(denied.status))throw Error('guest_access_not_denied_'+denied.status);
 const auth='Basic '+Buffer.from(process.env.WOO_KEY+':'+process.env.WOO_SECRET).toString('base64');
 const r=await get({Accept:'application/json',Authorization:auth});
 if(!r.ok)throw Error('catalog_reader_http_'+r.status);
 const rows=await r.json();if(!Array.isArray(rows)||rows.length!==1||!Number.isSafeInteger(rows[0].id)||!r.headers.get('X-WP-TotalPages')||!r.headers.get('Cache-Control')?.includes('no-store'))throw Error('catalog_reply_invalid');
 console.log('dedicated_catalog_reader_validated=true');
}catch(e){console.error(/^catalog_reader_http_\d{3}$|^guest_access_not_denied_\d{3}$|^catalog_reply_invalid$/.test(e.message)?e.message:'catalog_preflight_failed');process.exit(1);}
NODE
cd "$ROOT/private"
grep -Fxq 'WOO_CATALOG_ADAPTER=1' .woo.env || printf '%s\n' WOO_CATALOG_ADAPTER=1 >> .woo.env
trap - ERR
echo catalog_adapter_enabled=true
