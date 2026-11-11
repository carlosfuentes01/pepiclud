#!/usr/bin/env bash
# Deja PepiCloud en estado limpio y consistente para la demostración:
# borra volúmenes (BD + respaldos), levanta todo y carga los datos de prueba.
# Con MinIO los datos persisten entre reinicios: este script solo hace falta para empezar de cero.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose down -v
docker compose up -d --build --wait
python3 scripts/datos_prueba.py
echo "Listo: http://localhost:3000"
