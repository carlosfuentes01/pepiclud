import { handle } from "@/lib/http";
import { downloadDocument } from "@/lib/documents";

export const dynamic = "force-dynamic";

export const GET = (_: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { doc, plain, servedFrom, attempts } = await downloadDocument((await params).id);
    return new Response(new Uint8Array(plain), {
      headers: {
        "Content-Type": doc.mime_type,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.original_name)}"`,
        "X-Served-From": servedFrom,
        "X-Attempts": JSON.stringify(attempts),
        "Access-Control-Expose-Headers": "X-Served-From, X-Attempts",
      },
    });
  });
