#!/usr/bin/env bash
# Ejecuta la operación "full" de PostgreSQL a través de la API de PepiCloud
# (la lógica vive en app/lib/backup.ts: pg_basebackup / pg_combinebackup / pg_ctl).
set -euo pipefail
B=${BASE_URL:-http://localhost:3000}
curl -sS -X POST "$B/api/backups/full" | python3 -m json.tool
