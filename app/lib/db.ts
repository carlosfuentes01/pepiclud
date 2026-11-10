// Capa de acceso a datos: pool de conexiones PostgreSQL.
import { Pool, PoolClient } from "pg";
import { config } from "./config";

const g = globalThis as unknown as { _pool?: Pool };

export function pool(): Pool {
  if (!g._pool) g._pool = new Pool({ ...config.pg, max: 5 });
  return g._pool;
}

export async function query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool().query(sql, params);
  return r.rows as T[];
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
