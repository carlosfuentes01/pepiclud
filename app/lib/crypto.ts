// Cifrado en reposo: AES-256-GCM. La clave viene de ENCRYPTION_KEY (variable de entorno).
// GCM además autentica el contenido: cualquier alteración del objeto almacenado se detecta al descifrar.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { config } from "./config";

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function encrypt(plain: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.encryptionKey, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { data, iv: iv.toString("hex"), authTag: cipher.getAuthTag().toString("hex") };
}

export function decrypt(data: Buffer, ivHex: string, tagHex: string): Buffer {
  const d = createDecipheriv("aes-256-gcm", config.encryptionKey, Buffer.from(ivHex, "hex"));
  d.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([d.update(data), d.final()]);
}
