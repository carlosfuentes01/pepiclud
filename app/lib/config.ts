// Configuración leída exclusivamente de variables de entorno (nunca valores en el código).
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable de entorno requerida no definida: ${name}`);
  return v;
}

export const config = {
  get pg() {
    return {
      host: process.env.PGHOST ?? "postgres",
      port: Number(process.env.PGPORT ?? 5432),
      database: req("POSTGRES_DB"),
      user: req("POSTGRES_USER"),
      password: req("POSTGRES_PASSWORD"),
    };
  },
  get repl() {
    return { user: req("PG_REPL_USER"), password: req("PG_REPL_PASSWORD") };
  },
  get s3() {
    return {
      endpoint: req("S3_ENDPOINT"),
      region: req("AWS_REGION"),
      accessKeyId: req("AWS_ACCESS_KEY_ID"),
      secretAccessKey: req("AWS_SECRET_ACCESS_KEY"),
    };
  },
  get buckets() {
    return {
      primary: req("BUCKET_PRIMARY"),
      secondary: req("BUCKET_SECONDARY"),
      backup: req("BUCKET_BACKUP"),
    } as const;
  },
  get encryptionKey(): Buffer {
    const hex = req("ENCRYPTION_KEY");
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("ENCRYPTION_KEY debe tener 64 caracteres hex (32 bytes)");
    return Buffer.from(hex, "hex");
  },
  get adminToken() {
    return req("ADMIN_TOKEN");
  },
  get retentionMinutes() {
    return Number(process.env.RETENTION_MINUTES ?? 30);
  },
  backupDir: process.env.BACKUP_DIR ?? "/backups",
};

export type Role = "primary" | "secondary" | "backup";
export const ROLES: Role[] = ["primary", "secondary", "backup"];
