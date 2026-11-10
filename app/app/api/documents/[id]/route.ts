import { handle } from "@/lib/http";
import { deleteDocument, getDocument, modifyDocument } from "@/lib/documents";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = (_: Request, { params }: Ctx) => handle(async () => getDocument((await params).id));

export const DELETE = (req: Request, { params }: Ctx) =>
  handle(async () => deleteDocument((await params).id, req.headers.get("x-admin-token")));

export const PUT = (req: Request, { params }: Ctx) =>
  handle(async () => {
    const f = await req.formData().catch(() => null);
    const file = f?.get("file");
    return modifyDocument((await params).id, req.headers.get("x-admin-token"), file instanceof File ? file : null);
  });
