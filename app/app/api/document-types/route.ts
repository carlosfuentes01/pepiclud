import { handle } from "@/lib/http";
import { query } from "@/lib/db";
import { HttpError } from "@/lib/documents";

export const dynamic = "force-dynamic";

export const GET = () => handle(() => query(`SELECT * FROM document_types ORDER BY id`));

export const POST = (req: Request) =>
  handle(async () => {
    const b = await req.json().catch(() => ({}));
    const code = String(b.code ?? "").trim().toUpperCase();
    const name = String(b.name ?? "").trim();
    if (!code || !name) throw new HttpError(400, "Código y nombre son obligatorios");
    return (await query(`INSERT INTO document_types (code, name) VALUES ($1,$2) RETURNING *`, [code, name]))[0];
  });
