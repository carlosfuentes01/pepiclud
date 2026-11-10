import { handle } from "@/lib/http";
import { query } from "@/lib/db";
import { HttpError } from "@/lib/documents";

export const dynamic = "force-dynamic";

export const GET = () => handle(() => query(`SELECT * FROM persons ORDER BY id`));

export const POST = (req: Request) =>
  handle(async () => {
    const b = await req.json().catch(() => ({}));
    const documentNumber = String(b.documentNumber ?? "").trim();
    const fullName = String(b.fullName ?? "").trim();
    if (!documentNumber || !fullName) throw new HttpError(400, "Número de identificación y nombre son obligatorios");
    const rows = await query(
      `INSERT INTO persons (document_number, full_name, birth_date) VALUES ($1,$2,$3) RETURNING *`,
      [documentNumber, fullName, b.birthDate || null],
    );
    return rows[0];
  });
