#!/bin/bash
# Se ejecuta cuando LocalStack está listo (ready.d).
# Crea 3 buckets independientes con versionado + Object Lock:
#   - BUCKET_PRIMARY   copia operativa 1 (activo-activo)
#   - BUCKET_SECONDARY copia operativa 2 (activo-activo)
#   - BUCKET_BACKUP    backup documental independiente
set -euo pipefail

for b in "$BUCKET_PRIMARY" "$BUCKET_SECONDARY" "$BUCKET_BACKUP"; do
  if awslocal s3api head-bucket --bucket "$b" 2>/dev/null; then
    echo "[init-s3] bucket $b ya existe"
    continue
  fi
  # --object-lock-enabled-for-bucket habilita también el versionado (obligatorio para Object Lock)
  awslocal s3api create-bucket --bucket "$b" --object-lock-enabled-for-bucket
  awslocal s3api put-bucket-versioning --bucket "$b" --versioning-configuration Status=Enabled
  echo "[init-s3] bucket $b creado con Object Lock"
done
echo "[init-s3] OK"
