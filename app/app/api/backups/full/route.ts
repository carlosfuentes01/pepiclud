import { handle } from "@/lib/http";
import { backup } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const POST = () => handle(() => backup("full"));
