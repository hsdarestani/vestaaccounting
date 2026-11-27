#!/usr/bin/env bash
# Compare available disk with the actual accounting release and backup footprint.
set -Eeuo pipefail
mode=${1:-}
image_bytes=${2:-}
[[ "$mode" == app-only || "$mode" == adapter ]]
[[ "$image_bytes" =~ ^[1-9][0-9]{0,11}$ ]]
root=/srv/vesta-accounting
test -f "$root/private/installed"
ram=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)
(( ram >= 2200 ))
docker_root=$(docker info --format '{{.DockerRootDir}}')
required=11776
if [[ "$mode" == app-only ]]; then
  cd "$root/release/runtime"
  database_bytes=$(docker compose --env-file "$root/private/.compose.env" -f compose.yml exec -T postgres     psql -X -A -t -U accounting -d vesta_accounting -v ON_ERROR_STOP=1 -c 'SELECT pg_database_size(current_database());')
  [[ "$database_bytes" =~ ^[1-9][0-9]{0,14}$ ]]
  mib=$((1024*1024))
  # Allow for Docker layer staging, extraction, rollback and peak dump/DB copy usage.
  working_mib=$(((4*image_bytes+3*database_bytes+mib-1)/mib))
fi
for filesystem in "$root" "$docker_root"; do
  read -r total available < <(df -Pm "$filesystem" | awk 'NR==2{print $2,$4}')
  if [[ "$mode" == app-only ]]; then
    reserve=$(((total+9)/10))
    if (( reserve < 8192 )); then reserve=8192; fi
    required=$((reserve+working_mib))
  fi
  printf 'upgrade_storage mode=%s available_mib=%s required_mib=%s\n' "$mode" "$available" "$required"
  (( available >= required ))
done
echo accounting_upgrade_capacity_verified=true
