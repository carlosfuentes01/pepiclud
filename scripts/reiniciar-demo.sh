#!/usr/bin/env bash
# Deja PepiCloud en estado limpio y consistente para la demostración:
# borra volúmenes (BD + respaldos), levanta todo y carga los datos de prueba.
# Úsalo también si Docker/LocalStack se reinició: LocalStack (edición gratuita) guarda S3 en memoria.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose down -v
docker compose up -d --build --wait
python3 scripts/datos_prueba.py
echo "Listo: http://localhost:3000"
