# ---- build: compila la app Next.js (standalone) ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime: Node + binarios de PostgreSQL 17 (pg_basebackup, pg_combinebackup, pg_ctl) ----
# locales: la instancia restaurada usa el mismo locale (en_US.utf8) que el cluster original
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates locales \
 && sed -i "s/^# *en_US.UTF-8/en_US.UTF-8/" /etc/locale.gen && locale-gen \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && mkdir -p /etc/postgresql-common && echo "create_main_cluster = false" > /etc/postgresql-common/createcluster.conf \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-17 \
 && apt-get purge -y curl && rm -rf /var/lib/apt/lists/*
ENV PATH=/usr/lib/postgresql/17/bin:$PATH NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Los backups van a un volumen propio, distinto del volumen de datos de PostgreSQL
RUN mkdir -p /backups && chown node:node /backups
# Sin secretos en la imagen: toda la configuración llega por variables de entorno en tiempo de ejecución
USER node
EXPOSE 3000
CMD ["node", "server.js"]
