#!/usr/bin/env bash
# Evidencias automáticas de PepiCloud. Uso:
#   ./scripts/evidencias.sh            -> todas las pruebas (excepto la eliminación tras la retención)
#   ./scripts/evidencias.sh post <ID>  -> eliminación de un documento cuya retención ya terminó
# La salida se guarda también en evidencias/evidencias_<fecha>.log
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
B=${BASE_URL:-http://localhost:3000}
OUT=evidencias; mkdir -p "$OUT"
LOG="$OUT/evidencias_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee "$LOG") 2>&1

PASS=0; FAIL=0
h()    { echo; echo "================ $* ================"; }
ok()   { echo "  [OK]    $*"; PASS=$((PASS+1)); }
bad()  { echo "  [FALLO] $*"; FAIL=$((FAIL+1)); }
check(){ if [ "$1" = "$2" ]; then ok "$3 (=$2)"; else bad "$3 (esperado $2, obtenido $1)"; fi; }
# Cliente MinIO (mc) con credenciales de ADMINISTRADOR (alias "pepi"), sin pasar por la app
mc_()  { docker compose run --rm -T --no-deps --entrypoint mc minio-init "$@"; }
psql_(){ docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$1"; }
denied(){ local o; o=$(mc_ "$@" 2>&1); echo "    -> ${o//$'\n'/ }"; [[ "$o" == *"WORM protected"* || "$o" == *AccessDenied* ]]; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
served(){ curl -s -D - -o "$TMP/dl.bin" "$B/api/documents/$1/download" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-served-from"{print $2}'; }
TMP=$(mktemp -d)

if [ "${1:-}" = "post" ]; then
  ID=$2
  h "Inmutabilidad: eliminación DESPUÉS de la retención"
  psql_ "select id, retain_until, now() > retain_until as retencion_cumplida from documents where id='$ID'"
  check "$(code -X DELETE -H 'x-admin-token: x' "$B/api/documents/$ID")" 401 "Eliminar sin permiso de administrador es rechazado"
  check "$(code -X DELETE -H "x-admin-token: $ADMIN_TOKEN" "$B/api/documents/$ID")" 200 "Administrador elimina el documento tras la retención"
  for b in "$BUCKET_PRIMARY" "$BUCKET_SECONDARY" "$BUCKET_BACKUP"; do
    n=$(mc_ ls --versions --recursive "pepi/$b/persons/" | grep -c "$ID")
    check "$n" 0 "Versiones restantes en $b"
  done
  echo; echo "RESULTADO: $PASS OK, $FAIL fallos"; exit $FAIL
fi

h "1. Gestión documental: persona + carga"
DOCN="E2E-$(date +%s)"
P=$(curl -s "$B/api/persons" -H 'Content-Type: application/json' -d "{\"documentNumber\":\"$DOCN\",\"fullName\":\"Paciente Evidencia\"}")
PID=$(echo "$P" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "  persona: $P"
check "$(code "$B/api/persons" -H 'Content-Type: application/json' -d "{\"documentNumber\":\"$DOCN\",\"fullName\":\"dup\"}")" 409 "Identificación duplicada rechazada"
check "$(code "$B/api/documents" -F personId=$PID -F typeId=1 -F title=sin-archivo)" 400 "Carga sin archivo rechazada"
printf 'INFORME CLINICO CONFIDENCIAL\nPaciente: Paciente Evidencia\nDiagnostico: texto legible de ejemplo\n' > "$TMP/informe.txt"
R=$(curl -s "$B/api/documents" -F personId=$PID -F typeId=2 -F title="Laboratorio evidencia" -F file=@"$TMP/informe.txt")
ID=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "  documento: $R"
KEY="persons/$PID/$ID"

h "2. Persistencia: metadatos y 3 referencias en PostgreSQL (sin BLOB)"
psql_ "select role, bucket, object_key, version_id from document_locations where document_id='$ID' order by role"
check "$(psql_ "select count(*) from document_locations where document_id='$ID'")" 3 "Ubicaciones registradas"
check "$(psql_ "select count(*) from information_schema.columns where table_schema='public' and data_type='bytea'")" 0 "Columnas bytea/BLOB en el esquema"

h "3. Cifrado en reposo"
echo "  Primeros bytes del objeto almacenado en $BUCKET_PRIMARY:"
mc_ cat "pepi/$BUCKET_PRIMARY/$KEY" > "$TMP/raw.bin"
xxd "$TMP/raw.bin" | head -3
if grep -q "CONFIDENCIAL" "$TMP/raw.bin"; then bad "El objeto almacenado contiene texto plano"; else ok "El objeto almacenado no contiene el texto original"; fi
for b in "$BUCKET_SECONDARY" "$BUCKET_BACKUP"; do
  mc_ cat "pepi/$b/$KEY" > "$TMP/raw_$b.bin"
  if grep -q CONFIDENCIAL "$TMP/raw_$b.bin"; then bad "Texto plano en $b"; else ok "Objeto cifrado en $b"; fi
done

h "4. Activo-activo: lecturas repartidas entre ambas copias operativas"
S1=$(served "$ID"); S2=$(served "$ID")
echo "  descarga 1 servida desde: $S1 | descarga 2 servida desde: $S2"
[ "$S1" != "$S2" ] && ok "Ambas copias operativas atienden lecturas" || bad "Las lecturas no se alternaron"
check "$(sha256sum < "$TMP/dl.bin" | cut -d' ' -f1)" "$(sha256sum < "$TMP/informe.txt" | cut -d' ' -f1)" "SHA-256 del archivo descargado = original"

h "5. Disponibilidad: pérdida de la copia primary"
curl -s -X POST "$B/api/documents/$ID/simulate-loss/primary"; echo
mc_ cat "pepi/$BUCKET_PRIMARY/$KEY" 2>&1 | grep -o "Object does not exist.*" | head -1
for i in 1 2; do check "$(served "$ID")" secondary "Descarga $i con primary perdida"; done

h "6. Disponibilidad: pérdida de AMBAS copias operativas -> backup"
curl -s -X POST "$B/api/documents/$ID/simulate-loss/secondary"; echo
check "$(served "$ID")" backup "Descarga con ambas copias operativas perdidas"
check "$(sha256sum < "$TMP/dl.bin" | cut -d' ' -f1)" "$(sha256sum < "$TMP/informe.txt" | cut -d' ' -f1)" "Contenido recuperado desde backup íntegro"
curl -s -X POST "$B/api/documents/$ID/restore-copy/primary" >/dev/null
curl -s -X POST "$B/api/documents/$ID/restore-copy/secondary" >/dev/null
S=$(served "$ID"); [ "$S" = primary ] || [ "$S" = secondary ] && ok "Copias reparadas, vuelve a servir una copia operativa ($S)" || bad "Copias no reparadas ($S)"

h "7. Integridad: alteración directa del objeto en S3 (sin pasar por la app)"
echo "contenido falso" > "$TMP/fake.txt"
mc_ pipe "pepi/$BUCKET_SECONDARY/$KEY" < "$TMP/fake.txt" >/dev/null
echo "  (se sobrescribió la clave en $BUCKET_SECONDARY: S3 crea una NUEVA versión; la original bloqueada permanece)"
for i in 1 2; do S=$(served "$ID"); [ "$S" = primary ] && ok "Descarga $i servida desde primary (copia alterada descartada por GCM/SHA-256)" || bad "Descarga $i servida desde $S"; done
VORIG=$(psql_ "select version_id from document_locations where document_id='$ID' and role='secondary'")
mc_ cat --version-id "$VORIG" "pepi/$BUCKET_SECONDARY/$KEY" >/dev/null && ok "La versión original sigue existiendo en $BUCKET_SECONDARY"

h "8. Inmutabilidad ANTES de los ${RETENTION_MINUTES} minutos"
mc_ retention info "pepi/$BUCKET_PRIMARY/$KEY"
check "$(code -X DELETE -H "x-admin-token: $ADMIN_TOKEN" "$B/api/documents/$ID")" 403 "App: eliminación por administrador rechazada"
curl -s -X DELETE -H "x-admin-token: $ADMIN_TOKEN" "$B/api/documents/$ID"; echo
check "$(code -X PUT -H "x-admin-token: $ADMIN_TOKEN" "$B/api/documents/$ID")" 403 "App: modificación por administrador rechazada"
VP=$(psql_ "select version_id from document_locations where document_id='$ID' and role='primary'")
echo "  Ataque directo a MinIO con credenciales de ADMINISTRADOR (sin pasar por la app):"
denied rm --version-id "$VP" "pepi/$BUCKET_PRIMARY/$KEY" && ok "Almacenamiento: borrar la versión -> rechazado (WORM)" || bad "El almacenamiento permitió borrar la versión"
denied rm --version-id "$VP" --bypass "pepi/$BUCKET_PRIMARY/$KEY" && ok "Almacenamiento: borrar con --bypass -> rechazado (WORM)" || bad "El almacenamiento permitió el bypass"
denied retention set --version-id "$VP" governance 1d "pepi/$BUCKET_PRIMARY/$KEY" && ok "Almacenamiento: cambiar el modo de retención -> rechazado (WORM)" || bad "El almacenamiento permitió cambiar la retención"
check "$(served "$ID" >/dev/null; sha256sum < "$TMP/dl.bin" | cut -d' ' -f1)" "$(sha256sum < "$TMP/informe.txt" | cut -d' ' -f1)" "El documento sigue disponible y sin modificaciones"

h "9. Secretos fuera del código y de la imagen"
IMG=$(docker compose images app --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | head -1); IMG=${IMG:-pepicloud-app:latest}
for v in "$POSTGRES_PASSWORD" "$ENCRYPTION_KEY" "$ADMIN_TOKEN" "$PG_REPL_PASSWORD" "$MINIO_ROOT_PASSWORD" "$S3_SECRET_KEY"; do
  if grep -rqF -- "$v" app/lib app/app db minio docker-compose.yml 2>/dev/null; then bad "Secreto encontrado en el código"; else ok "Secreto ausente del código fuente"; fi
  if docker image inspect "$IMG" --format '{{json .Config.Env}}' | grep -qF -- "$v" || docker history --no-trunc "$IMG" | grep -qF -- "$v"; then bad "Secreto encontrado en la imagen"; else ok "Secreto ausente de la imagen ($IMG)"; fi
done
docker run --rm --entrypoint sh "$IMG" -c 'ls -a /app | grep -q "^.env" && echo SI || echo NO' | grep -q NO && ok "No hay archivo .env dentro de la imagen" || bad ".env dentro de la imagen"

echo; echo "Documento de prueba: $ID (retención hasta $(psql_ "select retain_until from documents where id='$ID'"))"
echo "Tras la retención ejecute: ./scripts/evidencias.sh post $ID"
echo; echo "RESULTADO: $PASS OK, $FAIL fallos   (log: $LOG)"
rm -rf "$TMP"
exit $FAIL
