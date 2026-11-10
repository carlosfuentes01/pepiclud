import { handle, parseRole } from "@/lib/http";
import { restoreCopy } from "@/lib/documents";

export const dynamic = "force-dynamic";

export const POST = (_: Request, { params }: { params: Promise<{ id: string; role: string }> }) =>
  handle(async () => {
    const p = await params;
    return restoreCopy(p.id, parseRole(p.role));
  });
