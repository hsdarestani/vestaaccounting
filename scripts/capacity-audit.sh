#!/usr/bin/env sh
# Run only with authorized read-only host access. No restart, writes or secrets.
set -eu
date -u
uptime
command -v lscpu >/dev/null && lscpu | awk '/^CPU\(s\):|^Model name:|^Thread\(s\) per core:/{print}' || true
free -h
df -hP -x tmpfs -x devtmpfs
command -v vmstat >/dev/null && vmstat 1 3 || true
command -v iostat >/dev/null && iostat -xz 1 2 || true
if command -v docker >/dev/null; then
  docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}} {{.BlockIO}} {{.PIDs}}' || true
fi
