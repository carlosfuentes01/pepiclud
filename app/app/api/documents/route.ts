import { handle } from "@/lib/http";
import { query } from "@/lib/db";
import { HttpError, uploadDocument } from "@/lib/documents";

export const dynamic = "force-dynamic";

export const GET = () =>
  handle(() =>
    query(`SELECT d.id, d.title, d.original_name, d.mime_type, d.size_bytes, d.sha256, d.retain_until, d.created_at,
                  p.full_name, p.document_number, t.name AS type_name
             FROM documents d JOIN persons p ON p.id = d.person_id JOIN document_types t ON t.id = d.type_id
            WHERE d.deleted_at IS NULL ORDER BY d.created_at DESC`),
  );

export const POST = (req: Request) =>
  handle(async () => {
    const f = await req.formData();
    const file = f.get("file");
    const personId = Number(f.get("personId"));
    const typeId = Number(f.get("typeId"));
    const title = String(f.get("title") ?? "").trim();
    if (!(file instanceof File)) throw new HttpError(400, "Debe adjuntar un archivo");
    if (!personId || !typeId || !title) throw new HttpError(400, "Persona, tipo y título son obligatorios");
    if (file.size > 20 * 1024 * 1024) throw new HttpError(400, "Tamaño máximo 20 MB");
    return uploadDocument({ personId, typeId, title, file });
  });
