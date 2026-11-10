import { handle, parseRole } from "@/lib/http";
import { simulateLoss } from "@/lib/documents";

export const dynamic = "force-dynamic";

export const POST = (_: Request, { params }: { params: Promise<{ id: string; role: string }> }) =>
  handle(async () => {
    const p = await params;
    return simulateLoss(p.id, parseRole(p.role));
  });
