// Capa de servicios: lógica de gestión documental (carga, recuperación con failover,
// estado de copias, simulación de pérdida, inmutabilidad).
import { randomUUID } from "crypto";
import { config, Role, ROLES } from "./config";
import { query, tx } from "./db";
import { encrypt, decrypt, sha256 } from "./crypto";
import * as st from "./storage";

export class HttpError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

type Loc = { role: Role; bucket: string; object_key: string; version_id: string };

export async function getDocument(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Id de documento inválido");
  const rows = await query(
    `SELECT d.*, p.full_name, p.document_number, t.name AS type_name
       FROM documents d JOIN persons p ON p.id = d.person_id JOIN document_types t ON t.id = d.type_id
      WHERE d.id = $1 AND d.deleted_at IS NULL`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, "Documento no encontrado");
  const locs = await query<Loc>(`SELECT role, bucket, object_key, version_id FROM document_locations WHERE document_id = $1`, [id]);
  return { doc: rows[0], locs: Object.fromEntries(locs.map((l) => [l.role, l])) as Record<Role, Loc> };
}

/** Cifra y escribe el archivo en los 3 buckets en paralelo, con Object Lock COMPLIANCE. */
async function writeAllCopies(key: string, plain: Buffer) {
  const enc = encrypt(plain);
  const retainUntil = new Date(Date.now() + config.retentionMinutes * 60_000);
  const results = await Promise.all(ROLES.map((role) => st.putLocked(st.bucketFor(role), key, enc.data, retainUntil)));
  return { enc, retainUntil, results };
}

export async function uploadDocument(input: { personId: number; typeId: number; title: string; file: File }) {
  const plain = Buffer.from(await input.file.arrayBuffer());
  if (plain.length === 0) throw new HttpError(400, "El archivo está vacío");
  const person = await query(`SELECT id FROM persons WHERE id = $1`, [input.personId]);
  if (!person[0]) throw new HttpError(400, "La persona no existe");
  const type = await query(`SELECT id FROM document_types WHERE id = $1`, [input.typeId]);
  if (!type[0]) throw new HttpError(400, "El tipo de documento no existe");

  const id = randomUUID();
  const key = `persons/${input.personId}/${id}`;
  const { enc, retainUntil, results } = await writeAllCopies(key, plain);

  await tx(async (c) => {
    await c.query(
      `INSERT INTO documents (id, person_id, type_id, title, original_name, mime_type, size_bytes, sha256, iv, auth_tag, retain_until)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, input.personId, input.typeId, input.title, input.file.name, input.file.type || "application/octet-stream",
       plain.length, sha256(plain), enc.iv, enc.authTag, retainUntil],
    );
    for (let i = 0; i < ROLES.length; i++) {
      await c.query(
        `INSERT INTO document_locations (document_id, role, bucket, object_key, version_id, etag) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, ROLES[i], st.bucketFor(ROLES[i]), key, results[i].versionId, results[i].etag],
      );
    }
  });
  return { id, retainUntil };
}

// Activo-activo: las lecturas se reparten alternadamente entre las dos copias operativas.
const g = globalThis as unknown as { _rr?: number };

/** Recupera el documento: copia preferida -> la otra copia operativa -> backup documental. */
export async function downloadDocument(id: string) {
  const { doc, locs } = await getDocument(id);
  g._rr = ((g._rr ?? 0) + 1) % 2;
  const order: Role[] = g._rr === 0 ? ["primary", "secondary", "backup"] : ["secondary", "primary", "backup"];
  const attempts: { role: Role; ok: boolean; error?: string }[] = [];

  for (const role of order) {
    const loc = locs[role];
    try {
      const data = await st.getCurrent(loc.bucket, loc.object_key);
      const plain = decrypt(data, doc.iv, doc.auth_tag); // falla si el objeto fue alterado
      if (sha256(plain) !== doc.sha256) throw new Error("Hash SHA-256 no coincide");
      attempts.push({ role, ok: true });
      console.log(`[download] doc=${id} servido desde ${role} intentos=${JSON.stringify(attempts)}`);
      return { doc, plain, servedFrom: role, attempts };
    } catch (e: any) {
      attempts.push({ role, ok: false, error: e?.name === "NoSuchKey" ? "NoSuchKey (copia no disponible)" : e?.message ?? String(e) });
    }
  }
  throw new HttpError(503, "Ninguna copia ni el backup están disponibles", attempts);
}

export async function documentStatus(id: string) {
  const { doc, locs } = await getDocument(id);
  const copies = await Promise.all(
    ROLES.map(async (role) => ({ role, bucket: locs[role].bucket, key: locs[role].object_key,
      versionId: locs[role].version_id, ...(await st.headInfo(locs[role].bucket, locs[role].object_key, locs[role].version_id)) })),
  );
  const remaining = Math.max(0, Math.ceil((new Date(doc.retain_until).getTime() - Date.now()) / 1000));
  return { id, retainUntil: doc.retain_until, remainingSeconds: remaining, locked: remaining > 0, copies };
}

export async function simulateLoss(id: string, role: Role) {
  const { locs } = await getDocument(id);
  return st.simulateLoss(locs[role].bucket, locs[role].object_key);
}

export async function restoreCopy(id: string, role: Role) {
  const { locs } = await getDocument(id);
  return st.restoreCopy(locs[role].bucket, locs[role].object_key);
}

function requireAdmin(token: string | null) {
  if (!token || token !== config.adminToken) throw new HttpError(401, "Se requiere token de administrador válido");
}

/**
 * Eliminación (solo administrador). No se valida el tiempo en el backend: se intenta el borrado
 * real en S3 y es el Object Lock COMPLIANCE quien lo rechaza mientras dure la retención.
 */
export async function deleteDocument(id: string, adminToken: string | null) {
  requireAdmin(adminToken);
  const { locs } = await getDocument(id);
  const report: Record<string, unknown> = {};
  for (const role of ROLES) {
    try {
      report[role] = await st.deleteAllVersions(locs[role].bucket, locs[role].object_key);
    } catch (e: any) {
      report[role] = { error: `${e?.name}: ${e?.message}` };
      throw new HttpError(403, "El almacenamiento rechazó la eliminación (Object Lock COMPLIANCE activo)", report);
    }
  }
  await query(`UPDATE documents SET deleted_at = now() WHERE id = $1`, [id]);
  return { deleted: true, report };
}

/**
 * Modificación. Durante la retención se intenta alterar la protección en S3 (acortar la retención)
 * para evidenciar que el almacenamiento lo rechaza; el contenido no se toca.
 * Después de la retención se permite reemplazar el contenido (nuevas versiones con nueva retención).
 */
export async function modifyDocument(id: string, adminToken: string | null, file: File | null) {
  requireAdmin(adminToken);
  const { doc, locs } = await getDocument(id);
  if (new Date(doc.retain_until).getTime() > Date.now()) {
    try {
      await st.tryShortenRetention(locs.primary.bucket, locs.primary.object_key, locs.primary.version_id);
    } catch (e: any) {
      throw new HttpError(403, "El almacenamiento rechazó la modificación (Object Lock COMPLIANCE activo)", `${e?.name}: ${e?.message}`);
    }
    throw new HttpError(500, "ALERTA: S3 aceptó acortar la retención (Object Lock no efectivo)");
  }
  if (!file || file.size === 0) throw new HttpError(400, "Debe enviar el nuevo archivo");
  const plain = Buffer.from(await file.arrayBuffer());
  const { enc, retainUntil, results } = await writeAllCopies(locs.primary.object_key, plain);
  await tx(async (c) => {
    await c.query(
      `UPDATE documents SET original_name=$2, mime_type=$3, size_bytes=$4, sha256=$5, iv=$6, auth_tag=$7, retain_until=$8 WHERE id=$1`,
      [id, file.name, file.type || "application/octet-stream", plain.length, sha256(plain), enc.iv, enc.authTag, retainUntil],
    );
    for (let i = 0; i < ROLES.length; i++)
      await c.query(`UPDATE document_locations SET version_id=$3, etag=$4 WHERE document_id=$1 AND role=$2`,
        [id, ROLES[i], results[i].versionId, results[i].etag]);
  });
  return { modified: true, retainUntil };
}
