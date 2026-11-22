#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=/srv/vesta-accounting
cd "$ROOT/release/runtime"
test -s "$ROOT/private/.woo.env"
test -s "$ROOT/private/.compose.env"
docker compose --env-file "$ROOT/private/.compose.env" -f compose.yml -f "$ROOT/private/compose.source-sync.yml" \
  --profile source-sync exec -T sync node --input-type=module < /dev/stdin
