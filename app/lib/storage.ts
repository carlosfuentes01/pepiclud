// Acceso al almacenamiento de objetos (MinIO, compatible con S3). Todos los objetos se escriben con
// Object Lock en modo COMPLIANCE: ni siquiera el administrador/root puede borrar ni acortar la retención.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  PutObjectRetentionCommand,
  GetObjectLockConfigurationCommand,
} from "@aws-sdk/client-s3";
import { config, Role } from "./config";

const g = globalThis as unknown as { _s3?: S3Client };

export function s3(): S3Client {
  if (!g._s3) {
    const c = config.s3;
    g._s3 = new S3Client({
      endpoint: c.endpoint,
      region: c.region,
      forcePathStyle: true,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
      maxAttempts: 1, // sin reintentos: la redundancia la gestiona el failover entre copias
    });
  }
  return g._s3;
}

export const bucketFor = (role: Role) => config.buckets[role];

export async function putLocked(bucket: string, key: string, body: Buffer, retainUntil: Date) {
  const r = await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/octet-stream",
      ObjectLockMode: "COMPLIANCE",
      ObjectLockRetainUntilDate: retainUntil,
    }),
  );
  return { versionId: r.VersionId!, etag: r.ETag ?? null };
}

/** Lee la versión vigente de la clave (si hay delete marker, la copia no está disponible). */
export async function getCurrent(bucket: string, key: string): Promise<Buffer> {
  const r = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}

export async function headInfo(bucket: string, key: string, versionId: string) {
  const out: {
    available: boolean;
    currentVersionId?: string;
    lockedVersionExists: boolean;
    lockMode?: string;
    retainUntil?: string;
    error?: string;
  } = { available: false, lockedVersionExists: false };
  try {
    const cur = await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    out.available = true;
    out.currentVersionId = cur.VersionId;
  } catch (e: any) {
    out.error = e?.name ?? String(e);
  }
  try {
    const v = await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }));
    out.lockedVersionExists = true;
    out.lockMode = v.ObjectLockMode;
    out.retainUntil = v.ObjectLockRetainUntilDate?.toISOString();
  } catch {
    /* versión inexistente */
  }
  return out;
}

async function listVersions(bucket: string, key: string) {
  const r = await s3().send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key }));
  const versions = (r.Versions ?? []).filter((v) => v.Key === key).map((v) => v.VersionId!);
  const markers = (r.DeleteMarkers ?? []).filter((m) => m.Key === key).map((m) => m.VersionId!);
  return { versions, markers };
}

/** Pérdida controlada: DELETE sin VersionId => S3 crea un delete marker (permitido aun con Object Lock). */
export async function simulateLoss(bucket: string, key: string) {
  const r = await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  return { deleteMarker: r.DeleteMarker ?? false, markerVersionId: r.VersionId };
}

/** Repara la copia eliminando los delete markers (la versión original bloqueada sigue intacta). */
export async function restoreCopy(bucket: string, key: string) {
  const { markers } = await listVersions(bucket, key);
  for (const m of markers) await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: m }));
  return { removedMarkers: markers.length };
}

/**
 * Eliminación definitiva: borra cada versión por VersionId. Durante la retención S3 responde
 * AccessDenied (COMPLIANCE). Se borra primero la versión de datos y luego los delete markers.
 */
export async function deleteAllVersions(bucket: string, key: string) {
  const { versions, markers } = await listVersions(bucket, key);
  for (const v of versions) await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: v }));
  for (const m of markers) await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: m }));
  return { deletedVersions: versions.length, deletedMarkers: markers.length };
}

/** Salud del bucket: accesible y con Object Lock habilitado. */
export async function bucketHealth(bucket: string) {
  try {
    const r = await s3().send(new GetObjectLockConfigurationCommand({ Bucket: bucket }));
    return { bucket, up: true, objectLock: r.ObjectLockConfiguration?.ObjectLockEnabled === "Enabled" };
  } catch (e: any) {
    return { bucket, up: false, objectLock: false, error: e?.name ?? String(e) };
  }
}

/** Intento de modificar la protección (acortar la retención). En COMPLIANCE S3 lo rechaza. */
export async function tryShortenRetention(bucket: string, key: string, versionId: string) {
  await s3().send(
    new PutObjectRetentionCommand({
      Bucket: bucket,
      Key: key,
      VersionId: versionId,
      Retention: { Mode: "COMPLIANCE", RetainUntilDate: new Date(Date.now() + 1000) },
    }),
  );
}
