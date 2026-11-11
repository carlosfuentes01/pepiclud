#!/usr/bin/env bash
# Inicialización de MinIO (se ejecuta una vez en el servicio minio-init):
#   - 3 buckets independientes con versionado + Object Lock:
#       BUCKET_PRIMARY   réplica operativa 1 (activo-activo)
#       BUCKET_SECONDARY réplica operativa 2 (activo-activo)
#       BUCKET_BACKUP    backup documental independiente
#   - usuario propio de la aplicación (la app no usa las credenciales de administrador)
# El alias "pepi" (credenciales de administrador) llega por la variable MC_HOST_pepi.
set -euo pipefail

until mc ls pepi >/dev/null 2>&1; do echo "[minio-init] esperando a MinIO…"; sleep 1; done

for b in "$BUCKET_PRIMARY" "$BUCKET_SECONDARY" "$BUCKET_BACKUP"; do
  # --with-lock habilita Object Lock y versionado (no se puede activar después de crear el bucket)
  mc mb --ignore-existing --with-lock "pepi/$b"
done

mc admin user add pepi "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
mc admin policy attach pepi readwrite --user "$S3_ACCESS_KEY" 2>/dev/null || true  # ya asignada en reinicios
echo "[minio-init] OK"
