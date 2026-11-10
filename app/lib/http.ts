// Utilidad común de la capa API: respuestas JSON y manejo uniforme de errores.
import { NextResponse } from "next/server";
import { HttpError } from "./documents";
import { Role, ROLES } from "./config";

export function handle(fn: () => Promise<unknown>) {
  return fn()
    .then((data) => (data instanceof Response ? data : NextResponse.json(data)))
    .catch((e: unknown) => {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, detail: e.detail }, { status: e.status });
      const err = e as { code?: string; message?: string };
      if (err?.code === "23505") return NextResponse.json({ error: "Registro duplicado" }, { status: 409 });
      console.error(e);
      return NextResponse.json({ error: err?.message ?? "Error interno" }, { status: 500 });
    });
}

export function parseRole(r: string): Role {
  if (!ROLES.includes(r as Role)) throw new HttpError(400, "Copia inválida (primary | secondary | backup)");
  return r as Role;
}
