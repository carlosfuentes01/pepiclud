# Guion de demostración – PepiCloud (≈ 15 min + verificación a los 30 min)

**Preparación (35 min antes de exponer):** `./scripts/reiniciar-demo.sh` (equivale a `docker compose down -v`, `docker compose up -d --build` y
`python3 scripts/datos_prueba.py`) (5 personas, 5 tipos y 7 documentos PDF ficticios cargados por la API) y abrir http://localhost:3000.
Al exponer, esos documentos ya tendrán cumplida la retención: cualquiera de ellos sirve como documento "A" en el paso 7.
Escribir `ADMIN_TOKEN` (valor de `.env`) en el campo "Clave de administrador" del encabezado.

Para las pruebas directas sobre el almacenamiento, definir en la terminal un alias del cliente MinIO con credenciales de **administrador**:
```bash
alias mcp='docker compose run --rm -T --no-deps --entrypoint mc minio-init'
```
La consola web de MinIO (http://localhost:9011, usuario `MINIO_ROOT_USER`) también muestra los buckets, versiones y retención.

## 1. Gestión documental y base de datos (2 min)
1. Menú **Pacientes**: registrar al paciente (identificación + nombre). Registrar el mismo número otra vez: el sistema lo rechaza por duplicado.
2. Mostrar los tipos de documento (semilla) y agregar uno nuevo.
3. Menú **Nuevo documento**: cargar un documento "B" (paciente + tipo + título + archivo) y pulsar **Guardar documento**. La app abre **Documentos** con el documento seleccionado; el aviso y **Actividad** (botón del encabezado) muestran el `id` y `retainUntil`.
4. Evidencia en la BD:
   ```bash
   docker compose exec postgres psql -U pepi_admin -d pepicloud -c "select * from documents" -c "select * from document_locations"
   ```
   Hay 3 referencias (primary, secondary, backup) con bucket, clave y `version_id`. El archivo no está en la BD.

## 2. Cifrado en reposo y secretos (2 min)
```bash
mcp cat pepi/pepi-primary/persons/<personId>/<docId> | xxd | head
```
Se ven bytes ilegibles. Descargar el mismo documento desde la UI devuelve el original.
Mostrar `.env.example` y `docker-compose.yml` (`env_file`): ningún secreto está en el código ni en la imagen
(`./scripts/evidencias.sh` lo comprueba con `docker history` / `inspect`).

## 3. Activo-activo (1 min)
En **Documentos**, seleccionar "B" en la lista. En «Almacenamiento» se ven las 3 réplicas disponibles y protegidas. Pulsar **Descargar** dos veces:
el resultado indica "servido desde SECONDARY" y luego "PRIMARY", porque ambas copias atienden lecturas.

## 4. Pérdida de una copia operativa (2 min)
1. En "Réplica primaria", pulsar **Simular pérdida**. La tarjeta pasa a «No disponible».
   Prueba de que es real: `mcp cat pepi/pepi-primary/<clave>` responde `Object does not exist`.
2. **Descargar**: "servido desde SECONDARY" y el panel muestra el intento fallido sobre primary. No se volvió a cargar el archivo.

## 5. Pérdida de ambas copias operativas → backup (2 min)
1. **Simular pérdida** también en "Réplica secundaria".
2. **Descargar**: "servido desde BACKUP" y el archivo es íntegro.
3. **Restaurar copia** en ambas réplicas para volver al estado normal.

## 6. Inmutabilidad antes de 30 min (2 min)
Sobre "B" (recién cargado, con el contador 🔒 corriendo):
1. **Eliminar documento** con la clave de administrador: HTTP 403 con `Object is WORM protected and cannot be overwritten`.
   El mensaje viene de **MinIO**, no de una validación del backend.
2. **Modificar retención**: HTTP 403 (MinIO rechaza cambiar la retención).
3. Ataque directo al almacenamiento con credenciales de administrador:
   ```bash
   mcp rm --version-id <version_id> --bypass pepi/pepi-primary/<clave>
   ```
   Responde `WORM protected and cannot be overwritten`. Volver a descargar "B": el documento sigue disponible y sin cambios.

## 7. Inmutabilidad después de 30 min (1 min)
Sobre el documento "A" (uno de los documentos de prueba cargados en la preparación, ahora con "Retención cumplida"):
1. Seleccionarlo, borrar la clave y pulsar **Eliminar documento**: 401, porque falta el permiso.
2. Con el token: 200. Desaparece de la lista y de los 3 buckets
   (`mcp ls --versions --recursive pepi/pepi-backup/persons/`).

## 8. Backup y restauración de PostgreSQL (3 min)
Menú **Respaldos**:
1. **Respaldo completo**. Registrar una persona nueva "Incremental 1".
2. **Respaldo incremental**. Registrar "Incremental 2" y luego otro **Respaldo incremental**. La tabla muestra que los incrementales pesan menos que el completo.
3. Registrar "No respaldada" (sin backup).
4. **Verificar restauración**: aparece «Restauración verificada»; la fila «Restaurado» (instancia temporal en el puerto 5433) coincide con
   «Esperado (último respaldo)» y los últimos pacientes incluyen "Incremental 1" e "Incremental 2", pero no "No respaldada".
   El detalle técnico (`pg_combinebackup full + incr + incr`) está en **Actividad**.
5. (Opcional, desastre real) `./scripts/restore-live.sh`: reemplaza `pg_data` por la cadena de backups y la app sigue funcionando con los datos restaurados.
   Ubicación de los respaldos: `docker compose exec app ls -la /backups` (volumen `pg_backups`, distinto de `pg_data`).

## Persistencia (opcional, 1 min)
`docker compose down && docker compose up -d`: al volver, los documentos siguen disponibles en sus 3 réplicas.

## Cierre
`./scripts/evidencias.sh` ejecuta todas las verificaciones automáticamente y deja el log en `evidencias/`.
