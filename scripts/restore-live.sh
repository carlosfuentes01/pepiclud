#!/usr/bin/env bash
# Recuperación ante desastre de PostgreSQL: reemplaza el volumen de datos en operación (pg_data)
# con la cadena de backups (full + incrementales) almacenada en el volumen pg_backups.
#   ./scripts/restore-live.sh        (pide confirmación)
#   ./scripts/restore-live.sh -y     (sin confirmación)
# ¡DESTRUCTIVO! Los cambios posteriores al último backup se pierden.
set -euo pipefail
cd "$(dirname "$0")/.."
P=$(docker compose config --format json | python3 -c 'import sys,json;print(json.load(sys.stdin)["name"])')

if [ "${1:-}" != "-y" ]; then
  read -r -p "Se reemplazarán los datos actuales de PostgreSQL por el último backup. ¿Continuar? (si/no) " a
  [ "$a" = "si" ] || { echo "Cancelado"; exit 1; }
fi

echo "1) Deteniendo app y postgres…"
docker compose stop app postgres

echo "2) Vaciando pg_data y reconstruyendo con pg_combinebackup (full + incrementales)…"
docker run --rm -v "${P}_pg_data:/var/lib/postgresql/data" -v "${P}_pg_backups:/backups" postgres:17 bash -euc '
  CHAIN=$(grep -o "\"name\": \"[^\"]*\"" /backups/chain.json | cut -d\" -f4 | sed "s#^#/backups/#" | tr "\n" " ")
  echo "   cadena: $CHAIN"
  find /var/lib/postgresql/data -mindepth 1 -delete
  pg_combinebackup $CHAIN -o /var/lib/postgresql/data
  chown -R postgres:postgres /var/lib/postgresql/data && chmod 700 /var/lib/postgresql/data
  echo "   datos restaurados"'

echo "3) Iniciando postgres y app…"
docker compose up -d --wait postgres
docker compose up -d app
set -a; source .env; set +a
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "select (select count(*) from persons) personas, (select count(*) from documents) documentos, (select count(*) from document_locations) ubicaciones"
echo "Restauración completada."
