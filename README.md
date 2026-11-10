# PepiCloud – Prototipo de gestión documental distribuida (Taller Práctico 2)

Prototipo on-premise, a escala, del flujo de gestión documental de PepiCloud: recepción, cifrado, almacenamiento redundante,
consulta, recuperación ante fallos, inmutabilidad y respaldo/restauración de la base de datos.

## Arquitectura

Tres contenedores (Docker Compose):

| Servicio | Imagen | Función |
|---|---|---|
| `app` | build propio (Node 22 + Next.js 15 + binarios PostgreSQL 17) | Monolito en capas: interfaz web + API REST + servicios. Ejecuta los backups de PostgreSQL. Puerto **3000**. |
| `postgres` | `postgres:17` | Información estructurada (personas, tipos, metadatos, referencias). `wal_level=replica`, `summarize_wal=on`. |
| `localstack` | `localstack/localstack:4.14` | S3 local con 3 buckets independientes, versionado + **Object Lock**. |

Volúmenes: `pg_data` (datos en operación) y `pg_backups` (respaldos, **separado** del volumen de datos).

```
Navegador ──HTTP 3000──▶ app (Next.js)
                          ├─ app/page.tsx          Presentación (React)
                          ├─ app/api/*             API REST (route handlers)
                          ├─ lib/documents.ts      Servicios: carga, failover, inmutabilidad
                          ├─ lib/crypto.ts         Cifrado AES-256-GCM
                          ├─ lib/storage.ts        Integración S3 (Object Lock)
                          ├─ lib/backup.ts         Backups PG (pg_basebackup / pg_combinebackup)
                          └─ lib/db.ts             Acceso a datos (pg)
                               │ SQL 5432                    │ S3 4566
                               ▼                             ▼
                          postgres (pg_data)        localstack: pepi-primary | pepi-secondary | pepi-backup
                               ▲ replicación (pg_basebackup)
                          volumen pg_backups (full + incrementales)
```

### Relación con el diseño del Taller 1 (`arq_sw_capas`)

| Taller 1 | Prototipo (Taller 2) |
|---|---|
| Frontend React SPA + Nginx | `app/app/page.tsx` (React, servido por Next.js) |
| Controladores REST `/pacientes`, `/documentos`, `/admin` | `app/app/api/persons`, `api/documents`, `api/backups` |
| Servicios de dominio (Pacientes, Documentos) | `app/lib/documents.ts` |
| Integraciones: cliente S3 | `app/lib/storage.ts` |
| Acceso a datos (JPA + PgBouncer) | `app/lib/db.ts` (pool `pg`) |
| S3 principal ×4 + réplica ×4 | buckets `pepi-primary` y `pepi-secondary` (activo-activo) |
| NAS de respaldo aislado | bucket `pepi-backup` + volumen `pg_backups` |
| PostgreSQL ×3 (Patroni) | 1 instancia PostgreSQL 17 |
| Vault (llaves) | variables de entorno (`.env`) |

En el prototipo a escala, la SPA y el backend van en un solo despliegue (monolito con capas lógicas separadas).
El enunciado del Taller 2 no exige separarlos, y así se reduce el número de componentes.

## Cómo se cumple cada requisito

| Requisito | Implementación |
|---|---|
| Documentos asociados a persona y tipo | Tablas `persons` (identificación única), `document_types`, `documents` (metadatos) y `document_locations` (referencias). `db/init/01-schema.sql` |
| Sin BLOB en PostgreSQL | El archivo va a S3; en la BD solo hay bucket, clave y `VersionId`. No hay columnas `bytea` (el script de evidencias lo comprueba). |
| 2 copias activo-activo | Cada carga escribe en paralelo en `pepi-primary` y `pepi-secondary`. Las lecturas se **alternan** entre ambas (round-robin), así las dos atienden tráfico. |
| Backup documental independiente | Tercer bucket `pepi-backup`. Solo se usa cuando las dos copias operativas fallan. |
| Recuperación sin recargar el archivo | `GET /api/documents/:id/download` intenta: copia preferida → la otra copia → backup. La cabecera `X-Served-From` indica qué copia respondió. |
| Pérdida controlada de una copia | `POST /api/documents/:id/simulate-loss/:role` ejecuta un `DeleteObject` real **sin VersionId**. S3 crea un *delete marker* y la clave deja de existir para cualquier lectura normal (`NoSuchKey`). La versión original sigue protegida por Object Lock, igual que en AWS. `restore-copy` quita el marker. |
| Integridad | AES-GCM autentica el contenido y además se compara el SHA-256. Si alguien sobrescribe un objeto directamente en S3, esa copia se descarta y se usa otra. |
| Cifrado en reposo | AES-256-GCM en la app **antes** de subir (clave `ENCRYPTION_KEY`). En S3 solo hay texto cifrado; el IV y el tag se guardan en PostgreSQL. |
| Secretos fuera del código y de las imágenes | Todo sale de `.env` (no versionado, excluido por `.dockerignore`) y se inyecta en tiempo de ejecución (`env_file`). El script de evidencias busca los secretos en el código, en `docker history` y en `docker inspect`. |
| Inmutabilidad de 30 min (incluso para admin) | Cada objeto se escribe con `ObjectLockMode=COMPLIANCE` y `RetainUntilDate = ahora + 30 min`. **El backend no filtra por tiempo**: siempre intenta el borrado real en S3, y S3 responde `AccessDenied`. Tampoco se puede acortar la retención ni borrar con `--bypass-governance-retention`, ni siquiera con las credenciales raíz. |
| Eliminación tras la retención | Requiere el token de administrador (`ADMIN_TOKEN`, el permiso establecido). Borra todas las versiones en los 3 buckets y marca `deleted_at`. |
| Modificación | Durante la retención, `PUT /api/documents/:id` intenta cambiar la protección en S3, S3 lo rechaza y la API devuelve 403. Pasada la retención, permite reemplazar el contenido (nuevas versiones con nueva retención). |
| Backup PG completo + incrementales | `pg_basebackup` (completo) y `pg_basebackup --incremental` (**backup incremental nativo de PostgreSQL 17**, basado en el resumen de WAL `summarize_wal`). Cada incremental contiene solo los bloques cambiados desde el backup anterior de la cadena. |
| Ubicación diferente | Volumen `pg_backups` (montado solo en `app`), distinto de `pg_data`. |
| Prueba de restauración | `pg_combinebackup` reconstruye full + incrementales, levanta una instancia PostgreSQL independiente (puerto 5433) sobre esos datos, la consulta y compara con lo esperado. `scripts/restore-live.sh` hace la recuperación real del servidor en operación. |

## Ejecución

Requisitos: Docker y Docker Compose v2. El puerto 3000 debe estar libre.

```bash
cd pepicloud
cp .env.example .env
# Edita .env: contraseñas, ADMIN_TOKEN y una clave nueva:
#   sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env
docker compose up -d --build
```

Opcional, para cargar datos de prueba (5 personas y 7 documentos PDF ficticios, por la misma API que usa la interfaz):

```bash
python3 scripts/datos_prueba.py
```

Abre **http://localhost:3000**. Para reiniciar desde cero: `docker compose down -v && docker compose up -d`.

> **LocalStack**: desde marzo de 2026 la imagen `latest` exige `LOCALSTACK_AUTH_TOKEN`. Este proyecto fija la etiqueta `4.14`,
> que funciona sin token. Si usas otra versión, pon tu token gratuito en `.env`.
>
> **Persistencia de LocalStack**: la edición comunitaria guarda S3 en memoria. Si reinicias solo el contenedor `localstack`,
> se pierden los objetos mientras PostgreSQL conserva las referencias. Para empezar de cero usa `docker compose down -v`.

## Backups y restauración de PostgreSQL

Desde la interfaz (menú «Respaldos») o por scripts:

```bash
./scripts/backup-full.sh          # backup completo inicial (inicia una cadena nueva)
./scripts/backup-incremental.sh   # incremental respecto al backup anterior de la cadena
./scripts/restore-test.sh         # combina la cadena, levanta una instancia aparte y verifica los datos
./scripts/restore-live.sh         # recuperación ante desastre: reemplaza pg_data con la cadena (DESTRUCTIVO)
```

Estructura en el volumen `pg_backups`:
```
/backups/full_<fecha>/    backup completo (backup_manifest)
/backups/incr_<fecha>/    incrementales (archivos INCREMENTAL.* con solo los bloques modificados)
/backups/chain.json       orden de la cadena + conteos de filas al momento de cada backup
/backups/restore/         última restauración de prueba
```

Procedimiento manual equivalente (lo que hace `restore-live.sh`):
1. `docker compose stop app postgres`
2. Vaciar el volumen de datos y ejecutar `pg_combinebackup /backups/full_X /backups/incr_1 ... /backups/incr_N -o $PGDATA`
3. `chown -R postgres:postgres $PGDATA && chmod 700 $PGDATA`
4. `docker compose up -d`. PostgreSQL arranca desde el `backup_label` y llega a un estado consistente con el último backup.

Recomendación: tras una restauración en vivo, haz un nuevo backup completo para iniciar una cadena limpia.

## Evidencias automáticas

```bash
./scripts/evidencias.sh               # 32 verificaciones: BD, cifrado, activo-activo, failover, integridad, inmutabilidad, secretos
./scripts/evidencias.sh post <ID>     # pasados 30 min: eliminación del documento de prueba
```
Cada ejecución queda registrada en `evidencias/evidencias_<fecha>.log`.

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET/POST | `/api/persons` | Listar / registrar persona `{documentNumber, fullName, birthDate}` |
| GET/POST | `/api/document-types` | Listar / registrar tipo `{code, name}` |
| GET/POST | `/api/documents` | Listar / cargar (multipart: `personId`, `typeId`, `title`, `file`) |
| GET | `/api/documents/:id/download` | Descarga con failover (`X-Served-From`, `X-Attempts`) |
| GET | `/api/documents/:id/status` | Estado de las 3 ubicaciones y retención restante |
| POST | `/api/documents/:id/simulate-loss/:role` | Pérdida controlada (`primary`, `secondary` o `backup`) |
| POST | `/api/documents/:id/restore-copy/:role` | Repara la copia (quita el delete marker) |
| DELETE | `/api/documents/:id` | Eliminar (cabecera `x-admin-token`) |
| PUT | `/api/documents/:id` | Modificar (cabecera `x-admin-token`, `file`) |
| GET | `/api/backups` | Cadena de backups |
| POST | `/api/backups/full`, `/incremental`, `/restore-test` | Operaciones de backup PG |

## Limitaciones conocidas (prototipo académico)

- Las 3 ubicaciones S3 son buckets independientes dentro de **una** instancia LocalStack. En producción irían en nodos físicos distintos (Taller 1).
- La "pérdida" de una copia se provoca con un delete marker real. Destruir la versión bloqueada es imposible por diseño: eso es justamente lo que garantiza el Object Lock.
- No hay autenticación de usuarios. El permiso de eliminación se modela con un token de administrador.
- El cifrado lo hace la aplicación, porque el SSE de LocalStack no cifra realmente los datos en disco.
