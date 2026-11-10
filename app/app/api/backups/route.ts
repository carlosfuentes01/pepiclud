import { handle } from "@/lib/http";
import { listBackups } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const GET = () => handle(() => listBackups());
