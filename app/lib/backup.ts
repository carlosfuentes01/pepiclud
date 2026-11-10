// Backups de PostgreSQL 17: completo (pg_basebackup) + incrementales nativos
// (pg_basebackup --incremental, basados en el resumen de WAL) y restauración real con pg_combinebackup.
// Los respaldos se guardan en BACKUP_DIR (volumen pg_backups), separado del volumen de datos.
import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import path from "path";
import { Client } from "pg";
import { config } from "./config";
import { query } from "./db";
import { HttpError } from "./documents";

const run = promisify(execFile);

type Entry = { name: string; type: "full" | "incremental"; createdAt: string; sizeBytes: number; counts: Counts };
type Chain = { backups: Entry[] };
type Counts = { persons: number; documents: number; locations: number };

const chainFile = () => path.join(config.backupDir, "chain.json");

async function readChain(): Promise<Chain> {
  try {
    return JSON.parse(await fs.readFile(chainFile(), "utf8"));
  } catch {
    return { backups: [] };
  }
}

async function dirSize(dir: string): Promise<number> {
  const { stdout } = await run("du", ["-sb", dir]);
  return Number(stdout.split("\t")[0]);
}

const COUNT_SQL = `SELECT (SELECT count(*) FROM persons)::int AS persons,
  (SELECT count(*) FROM documents)::int AS documents,
  (SELECT count(*) FROM document_locations)::int AS locations`;

async function liveCounts(): Promise<Counts> {
  return (await query<Counts>(COUNT_SQL))[0];
}

let busy = false;
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (busy) throw new HttpError(409, "Ya hay una operación de backup/restauración en curso");
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

function pgEnv() {
  return { ...process.env, PGPASSWORD: config.repl.password };
}

export function listBackups() {
  return readChain();
}

export function backup(type: "full" | "incremental") {
  return exclusive(async () => {
    const chain = await readChain();
    if (type === "incremental" && chain.backups.length === 0)
      throw new HttpError(400, "Primero debe existir un backup completo");
    const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
    const name = `${type === "full" ? "full" : "incr"}_${ts}`;
    const target = path.join(config.backupDir, name);
    const args = ["-h", config.pg.host, "-p", String(config.pg.port), "-U", config.repl.user, "-D", target, "-c", "fast"];
    if (type === "incremental") {
      const prev = chain.backups[chain.backups.length - 1];
      args.push(`--incremental=${path.join(config.backupDir, prev.name, "backup_manifest")}`);
    }
    const counts = await liveCounts(); // estado de los datos en el momento del respaldo
    await run("pg_basebackup", args, { env: pgEnv() });
    const entry: Entry = { name, type, createdAt: new Date().toISOString(), sizeBytes: await dirSize(target), counts };
    // Un backup completo inicia una nueva cadena; los anteriores se conservan en disco.
    const next: Chain = type === "full" ? { backups: [entry] } : { backups: [...chain.backups, entry] };
    await fs.writeFile(chainFile(), JSON.stringify(next, null, 2));
    return { ...entry, chainLength: next.backups.length };
  });
}

/**
 * Prueba real de restauración: combina full + incrementales en un directorio nuevo,
 * levanta una instancia PostgreSQL independiente (puerto 5433) sobre esos datos y consulta su contenido.
 */
export function restoreTest() {
  return exclusive(async () => {
    const chain = await readChain();
    if (chain.backups.length === 0) throw new HttpError(400, "No hay backups para restaurar");
    const restoreDir = path.join(config.backupDir, "restore");
    const dataDir = path.join(restoreDir, "data");
    const log: string[] = [];
    await stopRestored(dataDir);
    await fs.rm(restoreDir, { recursive: true, force: true });
    await fs.mkdir(restoreDir, { recursive: true });

    const inputs = chain.backups.map((b) => path.join(config.backupDir, b.name));
    await run("pg_combinebackup", [...inputs, "-o", dataDir]);
    log.push(`pg_combinebackup ${chain.backups.map((b) => b.name).join(" + ")} -> ${dataDir}`);
    await fs.chmod(dataDir, 0o700);

    await run("pg_ctl", ["-D", dataDir, "-w", "-t", "60", "-l", path.join(restoreDir, "postgres.log"), "start",
      "-o", "-p 5433 -c listen_addresses='' -c unix_socket_directories=/tmp -c summarize_wal=off"]);
    log.push("Instancia restaurada iniciada en el puerto 5433");

    const client = new Client({ host: "/tmp", port: 5433, database: config.pg.database, user: config.pg.user, password: config.pg.password });
    try {
      await client.connect();
      const restored = (await client.query<Counts>(COUNT_SQL)).rows[0];
      const lastDocs = (await client.query(
        `SELECT d.id, d.title, p.full_name, d.created_at FROM documents d JOIN persons p ON p.id = d.person_id ORDER BY d.created_at DESC LIMIT 5`,
      )).rows;
      const lastPersons = (await client.query(
        `SELECT id, document_number, full_name, created_at FROM persons ORDER BY id DESC LIMIT 5`,
      )).rows;
      const expected = chain.backups[chain.backups.length - 1].counts;
      const live = await liveCounts();
      const ok = restored.persons === expected.persons && restored.documents === expected.documents && restored.locations === expected.locations;
      log.push(ok ? "Los conteos restaurados coinciden con el último backup" : "Los conteos NO coinciden con el último backup");
      return { ok, chain: chain.backups.map((b) => `${b.name} (${b.type})`), expectedAtLastBackup: expected, restored, live, lastPersons, lastDocs, log };
    } finally {
      await client.end().catch(() => {});
      await stopRestored(dataDir);
      log.push("Instancia restaurada detenida");
    }
  });
}

async function stopRestored(dataDir: string) {
  try {
    await fs.access(path.join(dataDir, "postmaster.pid"));
    await run("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"]);
  } catch {
    /* no estaba corriendo */
  }
}
