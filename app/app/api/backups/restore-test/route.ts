import { handle } from "@/lib/http";
import { restoreTest } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const POST = () => handle(() => restoreTest());
