import { handle } from "@/lib/http";
import { query } from "@/lib/db";
import { bucketHealth, bucketFor } from "@/lib/storage";
import { ROLES, config } from "@/lib/config";

export const dynamic = "force-dynamic";

// Estado de la infraestructura: PostgreSQL y los 3 buckets (con Object Lock).
export const GET = () =>
  handle(async () => {
    let postgres = false;
    try {
      await query("SELECT 1");
      postgres = true;
    } catch {}
    const buckets = await Promise.all(ROLES.map(async (role) => ({ role, ...(await bucketHealth(bucketFor(role))) })));
    return { postgres, buckets, retentionMinutes: config.retentionMinutes };
  });
