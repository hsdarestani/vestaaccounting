#!/usr/bin/env bash
# Upgrade the existing accounting compose project in place; no storefront services.
set -Eeuo pipefail
umask 077
ROOT=/srv/vesta-accounting
release=${1:-}
[[ "$release" =~ ^[a-f0-9]{40}$ ]]
cd "$ROOT"
test -f private/installed
exec 9>"$ROOT/.install.lock"
flock -n 9
bootstrap="$ROOT/private/upgrade-login.json"
trap 'rm -f -- "$bootstrap"' EXIT
test -s "$bootstrap"
docker image inspect "vesta-accounting:$release" >/dev/null
cd release/runtime
compose() { docker compose --env-file "$ROOT/private/.compose.env" -f compose.yml "$@"; }
docker_root=$(docker info --format '{{.DockerRootDir}}')
for filesystem in "$ROOT" "$docker_root"; do
  (( $(df -Pm "$filesystem" | awk 'NR==2{print $4}') >= 11264 ))
done
(( $(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo) >= 2200 ))
snapshot=$(mktemp -d "$ROOT/backups/upgrade.XXXXXXXX")
cp -- "$ROOT/private/.compose.env" "$ROOT/private/.private.env" "$snapshot/"
compose exec -T postgres pg_dump -U accounting -d vesta_accounting -Fc > "$snapshot/accounting.dump"
compose exec -T postgres pg_restore -l < "$snapshot/accounting.dump" >/dev/null
rollback() {
  cp -- "$snapshot/.compose.env" "$ROOT/private/.compose.env"
  cp -- "$snapshot/.private.env" "$ROOT/private/.private.env"
  compose up -d --no-deps --pull never --wait app >/dev/null &&
  compose up -d --no-deps --pull never --wait --force-recreate proxy >/dev/null
}
trap 'code=$?; trap - ERR; rollback || echo accounting_rollback_needs_inspection; exit "$code"' ERR
python3 - "$ROOT/private" "$release" <<'PY'
import os, pathlib, re, sys
root, release = pathlib.Path(sys.argv[1]), sys.argv[2]
for name, wanted in {
    '.compose.env': {'ACCOUNTING_IMAGE': 'vesta-accounting:'+release},
    '.private.env': {'RELEASE': release, 'MFA_REQUIRED': '0'},
}.items():
    path = root/name
    old = path.read_text().splitlines()
    keys = wanted.keys() | ({'ADMIN_TOTP_SECRET'} if name == '.private.env' else set())
    lines = [line for line in old if line.partition('=')[0] not in keys]
    next_path = root/(name+'.upgrade')
    next_path.write_text('\n'.join(lines + [f'{k}={v}' for k,v in wanted.items()])+'\n')
    next_path.chmod(0o600)
    os.replace(next_path, path)
PY
compose up -d --no-deps --pull never --wait app
compose up -d --no-deps --pull never --wait --force-recreate proxy
python3 "$ROOT/private/verify-accounting-login.py" http://127.0.0.1:18089 "$bootstrap" "$release"
trap - ERR
echo accounting_upgrade_verified=true
