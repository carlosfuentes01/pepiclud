import { handle } from "@/lib/http";
import { documentStatus } from "@/lib/documents";

export const dynamic = "force-dynamic";

export const GET = (_: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => documentStatus((await params).id));
