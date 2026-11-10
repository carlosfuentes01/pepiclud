#!/bin/bash
# Crea el usuario de replicación usado por pg_basebackup (backups completos e incrementales)
# y habilita conexiones de replicación. Credenciales tomadas de variables de entorno.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE ${PG_REPL_USER} WITH REPLICATION LOGIN PASSWORD '${PG_REPL_PASSWORD}';
  GRANT pg_read_all_data TO ${PG_REPL_USER};
EOSQL

echo "host replication ${PG_REPL_USER} all scram-sha-256" >> "$PGDATA/pg_hba.conf"
