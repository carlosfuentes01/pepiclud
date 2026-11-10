"use client";
// Capa de presentación: aplicación web que consume la API REST (/api/*).
import { useCallback, useEffect, useState } from "react";

type Person = { id: number; document_number: string; full_name: string; birth_date: string | null };
type DocType = { id: number; code: string; name: string };
type Doc = {
  id: string; title: string; original_name: string; size_bytes: number; sha256: string; retain_until: string;
  created_at: string; full_name: string; document_number: string; type_name: string;
};
type Copy = {
  role: string; bucket: string; key: string; versionId: string; available: boolean;
  lockedVersionExists: boolean; lockMode?: string; retainUntil?: string; error?: string;
};
type Status = { remainingSeconds: number; locked: boolean; retainUntil: string; copies: Copy[] };
type Health = { postgres: boolean; retentionMinutes: number; buckets: { role: string; bucket: string; up: boolean; objectLock: boolean }[] };
type Attempt = { role: string; ok: boolean; error?: string };
type Tab = "pacientes" | "nuevo" | "documentos" | "respaldos";
type LogEntry = { id: number; time: string; title: string; status?: number; ok: boolean; data: unknown };

const ROLE: Record<string, string> = { primary: "Réplica primaria", secondary: "Réplica secundaria", backup: "Respaldo documental" };

async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, init);
  const ct = r.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await r.json() : null;
  return { ok: r.ok, status: r.status, body };
}

const fmtRemaining = (s: number) => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const fmtDate = (d: string) => new Date(d).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
const fmtTime = (d: string | Date) => new Date(d).toLocaleTimeString("es-CO", { hour12: false });
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Iconos (trazos estilo "feather")
const ICONS: Record<string, React.ReactNode> = {
  users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5M12 3v12" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  db: <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></>,
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5M12 15V3" /></>,
  search: <><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></>,
  refresh: <><path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></>,
  trash: <path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />,
  edit: <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />,
  key: <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  unlock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-2" /></>,
  server: <><rect x="2" y="3" width="20" height="7" rx="2" /><rect x="2" y="14" width="20" height="7" rx="2" /><path d="M6 6.5h.01M6 17.5h.01" /></>,
  check: <path d="M20 6L9 17l-5-5" />,
  plus: <path d="M12 5v14M5 12h14" />,
};
function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

export default function Home() {
  const [persons, setPersons] = useState<Person[]>([]);
  const [types, setTypes] = useState<DocType[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [backups, setBackups] = useState<any[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [restore, setRestore] = useState<any>(null);
  const [lastDl, setLastDl] = useState<Record<string, { servedFrom: string; attempts: Attempt[] }>>({});
  const [token, setToken] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState<Tab>("documentos");
  const [logOpen, setLogOpen] = useState(false);
  const [toast, setToast] = useState<{ id: number; title: string; ok: boolean; status?: number } | null>(null);
  const [qPersons, setQPersons] = useState("");
  const [qDocs, setQDocs] = useState("");
  const [fileName, setFileName] = useState("");

  const push = (title: string, ok: boolean, data: unknown, status?: number) => {
    const id = Date.now() + Math.random();
    setLog((l) => [{ id, time: fmtTime(new Date()), title, ok, data, status }, ...l].slice(0, 50));
    setToast({ id, title, ok, status });
  };

  const changeTab = (t: Tab) => { setTab(t); history.replaceState(null, "", `#${t}`); };
  useEffect(() => {
    const h = location.hash.slice(1) as Tab;
    if (["pacientes", "nuevo", "documentos", "respaldos"].includes(h)) setTab(h);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast((c) => (c?.id === toast.id ? null : c)), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    const [p, t, d, b, h] = await Promise.all([
      api("/api/persons"), api("/api/document-types"), api("/api/documents"), api("/api/backups"), api("/api/health"),
    ]);
    if (p.ok) setPersons(p.body);
    if (t.ok) setTypes(t.body);
    if (d.ok) setDocs(d.body);
    if (b.ok) setBackups(b.body.backups);
    if (h.ok) setHealth(h.body);
  }, []);

  const loadStatus = useCallback(async (id: string) => {
    const r = await api(`/api/documents/${id}/status`);
    if (r.ok) setStatus(r.body);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (selected) loadStatus(selected); else setStatus(null); }, [selected, loadStatus]);

  const openDoc = (id: string) => { setSelected(id); changeTab("documentos"); };

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try { await fn(); } catch (e) { push(key, false, String(e)); } finally { setBusy(null); }
  }

  const postJson = (url: string, form: HTMLFormElement, title: string) =>
    act(title, async () => {
      const r = await api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      push(r.ok ? title : r.body?.error ?? title, r.ok, r.body, r.status);
      if (r.ok) { form.reset(); load(); }
    });

  const upload = (form: HTMLFormElement) =>
    act("upload", async () => {
      const r = await api("/api/documents", { method: "POST", body: new FormData(form) });
      push(r.ok ? "Documento guardado" : r.body?.error ?? "Error al guardar", r.ok, r.body, r.status);
      if (r.ok) { form.reset(); setFileName(""); await load(); openDoc(r.body.id); }
    });

  const download = (id: string) =>
    act(`dl-${id}`, async () => {
      const r = await fetch(`/api/documents/${id}/download`);
      if (!r.ok) { const b = await r.json(); push(b?.error ?? "No se pudo descargar", false, b, r.status); loadStatus(id); return; }
      const servedFrom = r.headers.get("X-Served-From") ?? "?";
      const attempts: Attempt[] = JSON.parse(r.headers.get("X-Attempts") ?? "[]");
      const blob = await r.blob();
      const name = decodeURIComponent((r.headers.get("Content-Disposition") ?? "").match(/filename="(.+)"/)?.[1] ?? "documento");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name; a.click();
      URL.revokeObjectURL(a.href);
      setLastDl((m) => ({ ...m, [id]: { servedFrom, attempts } }));
      push(`Descargado desde ${ROLE[servedFrom] ?? servedFrom}`, true, { servedFrom, attempts, bytes: blob.size }, r.status);
    });

  const copyAction = (id: string, role: string, kind: "simulate-loss" | "restore-copy") =>
    act(`${kind}-${role}`, async () => {
      const r = await api(`/api/documents/${id}/${kind}/${role}`, { method: "POST" });
      push(`${kind === "simulate-loss" ? "Pérdida simulada" : "Copia restaurada"}: ${ROLE[role]}`, r.ok, r.body, r.status);
      await loadStatus(id);
    });

  const remove = (id: string) =>
    act(`del-${id}`, async () => {
      const r = await api(`/api/documents/${id}`, { method: "DELETE", headers: { "x-admin-token": token } });
      push(r.ok ? "Documento eliminado" : r.body?.error ?? "No se pudo eliminar", r.ok, r.body, r.status);
      if (r.ok) { if (selected === id) setSelected(null); load(); } else if (selected === id) loadStatus(id);
    });

  const modify = (id: string, file?: File) =>
    act("modify", async () => {
      const fd = new FormData();
      if (file) fd.append("file", file);
      const r = await api(`/api/documents/${id}`, { method: "PUT", headers: { "x-admin-token": token }, body: fd });
      push(r.ok ? "Documento actualizado" : r.body?.error ?? "No se pudo modificar", r.ok, r.body, r.status);
      load(); loadStatus(id);
    });

  const runBackup = (kind: "full" | "incremental" | "restore-test") =>
    act(kind, async () => {
      const r = await api(`/api/backups/${kind}`, { method: "POST" });
      const label = { full: "Respaldo completo creado", incremental: "Respaldo incremental creado", "restore-test": r.body?.ok ? "Restauración verificada" : "Verificación de restauración" }[kind];
      push(r.ok ? label : r.body?.error ?? "Error en el respaldo", r.ok, r.body, r.status);
      if (kind === "restore-test") setRestore(r.ok ? r.body : { error: r.body?.error });
      load();
    });

  const remaining = (d: Doc) => Math.max(0, Math.ceil((new Date(d.retain_until).getTime() - now) / 1000));
  const totalRet = (d: Doc) => Math.max(1, (new Date(d.retain_until).getTime() - new Date(d.created_at).getTime()) / 1000);
  const sel = docs.find((d) => d.id === selected);
  const dl = sel ? lastDl[sel.id] : undefined;
  const healthy = !!health && health.postgres && health.buckets.every((b) => b.up);

  const filteredPersons = persons.filter((p) => norm(`${p.full_name} ${p.document_number}`).includes(norm(qPersons)));
  const filteredDocs = docs.filter((d) => norm(`${d.title} ${d.full_name} ${d.document_number} ${d.type_name}`).includes(norm(qDocs)));

  const NAV: { id: Tab; icon: string; label: string; count?: number }[] = [
    { id: "documentos", icon: "file", label: "Documentos", count: docs.length },
    { id: "nuevo", icon: "upload", label: "Nuevo documento" },
    { id: "pacientes", icon: "users", label: "Pacientes", count: persons.length },
    { id: "respaldos", icon: "db", label: "Respaldos", count: backups.length },
  ];
  const TITLES: Record<Tab, [string, string]> = {
    documentos: ["Documentos", "Consulta y administración de documentos clínicos"],
    nuevo: ["Nuevo documento", "Registrar un documento clínico de un paciente"],
    pacientes: ["Pacientes", "Pacientes y tipos de documento"],
    respaldos: ["Respaldos", "Respaldos y restauración de la base de datos"],
  };

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <div className="logo">P</div>
          <div><b>PepiCloud</b><span>Documentos clínicos</span></div>
        </div>
        <nav>
          {NAV.map((n) => (
            <button key={n.id} className={tab === n.id ? "active" : ""} onClick={() => changeTab(n.id)}>
              <Icon name={n.icon} />{n.label}{n.count !== undefined && <span className="count">{n.count}</span>}
            </button>
          ))}
        </nav>
        <div className="sys">
          <div className="sys-title"><span className={`dot ${healthy ? "up" : "down"}`} />{healthy ? "Sistema operativo" : "Servicio degradado"}</div>
          <ul>
            <li><span className={`dot ${health?.postgres ? "up" : "down"}`} />Base de datos</li>
            {health?.buckets.map((b) => <li key={b.role}><span className={`dot ${b.up ? "up" : "down"}`} />{ROLE[b.role]}</li>)}
          </ul>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1>{TITLES[tab][0]}</h1>
            <p>{TITLES[tab][1]}</p>
          </div>
          <div className="top-actions">
            <label className="key" title="Clave de administrador">
              <Icon name="key" />
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Clave de administrador" aria-label="Clave de administrador" />
            </label>
            <button className="ghost" onClick={() => setLogOpen(true)}>
              <Icon name="activity" /> Actividad{log.length > 0 && <span className="badge">{log.length}</span>}
            </button>
          </div>
        </header>

        <div className="content">
          {tab === "documentos" && (
            <div className="master-detail">
              <section className="card master">
                <label className="search"><Icon name="search" /><input value={qDocs} onChange={(e) => setQDocs(e.target.value)} placeholder="Buscar por título, paciente o tipo" /></label>
                <ul className="doclist">
                  {filteredDocs.map((d) => {
                    const rem = remaining(d);
                    return (
                      <li key={d.id} className={d.id === selected ? "sel" : ""} onClick={() => setSelected(d.id)}>
                        <div className="dl-top">
                          <b>{d.title}</b>
                          <span className={`lockchip ${rem > 0 ? "locked" : "free"}`}><Icon name={rem > 0 ? "lock" : "unlock"} size={12} />{rem > 0 ? fmtRemaining(rem) : "Libre"}</span>
                        </div>
                        <div className="dl-meta"><span>{d.full_name}</span><span>{d.type_name}</span></div>
                      </li>
                    );
                  })}
                </ul>
                {filteredDocs.length === 0 && <p className="empty">{docs.length ? "Sin resultados." : "Aún no hay documentos."}</p>}
              </section>

              {sel ? (
                <section className="card detail">
                  <div className="detail-head">
                    <div className="file-icon"><Icon name="file" size={22} /></div>
                    <div className="grow">
                      <h2>{sel.title}</h2>
                      <div className="meta">
                        <span>{sel.full_name} · {sel.document_number}</span>
                        <span className="chip">{sel.type_name}</span>
                        <span>{sel.original_name}</span><span>{fmtBytes(sel.size_bytes)}</span><span>{fmtDate(sel.created_at)}</span>
                      </div>
                    </div>
                    <div className="row">
                      <button className="ghost icon" onClick={() => loadStatus(sel.id)} title="Actualizar estado" aria-label="Actualizar estado"><Icon name="refresh" /></button>
                      <button className="primary" onClick={() => download(sel.id)} disabled={!!busy}><Icon name="download" /> Descargar</button>
                    </div>
                  </div>

                  {dl && (
                    <div className={`notice ${dl.attempts.some((a) => !a.ok) ? "warn" : "info"}`}>
                      Última descarga servida desde <b>{ROLE[dl.servedFrom]}</b>
                      {dl.attempts.filter((a) => !a.ok).length > 0 && <> · no disponible: {dl.attempts.filter((a) => !a.ok).map((a) => ROLE[a.role]).join(", ")}</>}
                    </div>
                  )}

                  <h3>Almacenamiento</h3>
                  <div className="copies">
                    {status?.copies.map((c) => (
                      <div key={c.role} className={`copy ${c.available ? "up" : "down"} ${dl?.servedFrom === c.role ? "served-by" : ""}`}>
                        <div className="copy-head">
                          <Icon name="server" />
                          <b>{ROLE[c.role]}</b>
                        </div>
                        <span className={`status ${c.available ? "ok" : "bad"}`}>{c.available ? "Disponible" : "No disponible"}</span>
                        <div className="loc mono" title={`versión ${c.versionId}`}>s3://{c.bucket}/{c.key}</div>
                        <div className="small muted">
                          {c.lockedVersionExists && c.retainUntil && new Date(c.retainUntil).getTime() > now
                            ? <span className="locked-txt"><Icon name="lock" size={12} /> Protegido hasta {fmtTime(c.retainUntil)}</span>
                            : c.lockedVersionExists ? "Sin retención activa" : "Versión eliminada"}
                          {dl?.servedFrom === c.role && <span className="last"> · Última lectura</span>}
                        </div>
                        <div className="copy-actions">
                          <button className="link danger-link" onClick={() => copyAction(sel.id, c.role, "simulate-loss")} disabled={!!busy || !c.available}>Simular pérdida</button>
                          <button className="link" onClick={() => copyAction(sel.id, c.role, "restore-copy")} disabled={!!busy || c.available}>Restaurar copia</button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <h3>Retención</h3>
                  {(() => {
                    const rem = remaining(sel);
                    return (
                      <div className={`retention ${rem > 0 ? "locked" : "free"}`}>
                        <div className="ret-icon"><Icon name={rem > 0 ? "lock" : "unlock"} size={20} /></div>
                        <div className="grow">
                          <b>{rem > 0 ? `Protegido · ${fmtRemaining(rem)} restantes` : "Retención cumplida"}</b>
                          <p>{rem > 0
                            ? `No se puede eliminar ni modificar hasta las ${fmtTime(sel.retain_until)}.`
                            : "El documento puede eliminarse con permisos de administrador."}</p>
                          <div className="bar"><div style={{ width: `${(rem / totalRet(sel)) * 100}%` }} /></div>
                        </div>
                        <div className="ret-actions">
                          <button className="danger" onClick={() => remove(sel.id)} disabled={!!busy}><Icon name="trash" /> Eliminar documento</button>
                          <button className="ghost" onClick={() => modify(sel.id)} disabled={!!busy}><Icon name="edit" /> Modificar retención</button>
                          <label className="ghost-btn">
                            <Icon name="upload" /> Reemplazar archivo
                            <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) modify(sel.id, f); e.target.value = ""; }} />
                          </label>
                        </div>
                      </div>
                    );
                  })()}
                </section>
              ) : (
                <section className="card placeholder">
                  <Icon name="file" size={36} />
                  <h2>Seleccione un documento</h2>
                  <p className="muted">Elija un documento de la lista para ver su detalle.</p>
                </section>
              )}
            </div>
          )}

          {tab === "nuevo" && (
            <section className="card narrow">
              <form className="stack" onSubmit={(e) => { e.preventDefault(); upload(e.currentTarget); }}>
                <div className="grid-2">
                  <label>Paciente
                    <select name="personId" required defaultValue="">
                      <option value="" disabled>Seleccione…</option>
                      {persons.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {p.document_number}</option>)}
                    </select>
                  </label>
                  <label>Tipo de documento
                    <select name="typeId" required defaultValue="">
                      <option value="" disabled>Seleccione…</option>
                      {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </label>
                </div>
                <label>Título<input name="title" placeholder="Ej.: Resultado de hemograma" required /></label>
                <label className="drop">
                  <Icon name="upload" size={28} />
                  <b>{fileName || "Seleccionar archivo"}</b>
                  <span>PDF, imagen o documento · máx. 20 MB</span>
                  <input name="file" type="file" required onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
                </label>
                <div className="form-foot">
                  <button className="primary big" disabled={!!busy}>{busy === "upload" ? "Guardando…" : "Guardar documento"}</button>
                </div>
              </form>
            </section>
          )}

          {tab === "pacientes" && (
            <div className="grid-2-1">
              <section className="card">
                <div className="card-head">
                  <h2>Pacientes</h2>
                  <label className="search sm"><Icon name="search" /><input value={qPersons} onChange={(e) => setQPersons(e.target.value)} placeholder="Buscar paciente" /></label>
                </div>
                <form className="inline" onSubmit={(e) => { e.preventDefault(); postJson("/api/persons", e.currentTarget, "Paciente registrado"); }}>
                  <input name="documentNumber" placeholder="N.º identificación" required />
                  <input name="fullName" placeholder="Nombre completo" required />
                  <input name="birthDate" type="date" aria-label="Fecha de nacimiento" />
                  <button disabled={!!busy}><Icon name="plus" /> Registrar paciente</button>
                </form>
                <div className="scroll">
                  <table>
                    <thead><tr><th>Identificación</th><th>Nombre</th><th>Nacimiento</th><th className="num-col">Documentos</th></tr></thead>
                    <tbody>{filteredPersons.map((p) => (
                      <tr key={p.id}>
                        <td className="mono">{p.document_number}</td><td>{p.full_name}</td>
                        <td className="muted">{p.birth_date ? new Date(p.birth_date).toLocaleDateString("es-CO", { timeZone: "UTC" }) : "—"}</td>
                        <td className="num-col">{docs.filter((d) => d.document_number === p.document_number).length}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                  {filteredPersons.length === 0 && <p className="empty">{persons.length ? "Sin resultados." : "Aún no hay pacientes."}</p>}
                </div>
              </section>
              <section className="card">
                <div className="card-head"><h2>Tipos de documento</h2></div>
                <ul className="types">{types.map((t) => <li key={t.id}><span className="code-tag">{t.code}</span>{t.name}</li>)}</ul>
                <form className="inline" onSubmit={(e) => { e.preventDefault(); postJson("/api/document-types", e.currentTarget, "Tipo de documento agregado"); }}>
                  <input name="code" placeholder="Código" required size={6} />
                  <input name="name" placeholder="Nombre" required />
                  <button className="ghost" disabled={!!busy}><Icon name="plus" /> Agregar</button>
                </form>
              </section>
            </div>
          )}

          {tab === "respaldos" && (
            <div className="stack-lg">
              <section className="card">
                <div className="card-head">
                  <h2>Historial de respaldos</h2>
                  <div className="row">
                    <button className="ghost" onClick={() => runBackup("full")} disabled={!!busy}>{busy === "full" ? "Respaldando…" : "Respaldo completo"}</button>
                    <button className="ghost" onClick={() => runBackup("incremental")} disabled={!!busy}>{busy === "incremental" ? "Respaldando…" : "Respaldo incremental"}</button>
                    <button className="primary" onClick={() => runBackup("restore-test")} disabled={!!busy}><Icon name="check" /> {busy === "restore-test" ? "Verificando…" : "Verificar restauración"}</button>
                  </div>
                </div>
                {backups.length > 0 ? (
                  <table>
                    <thead><tr><th>#</th><th>Tipo</th><th>Fecha</th><th>Tamaño</th><th className="num-col">Pacientes</th><th className="num-col">Documentos</th></tr></thead>
                    <tbody>{backups.map((b, i) => (
                      <tr key={b.name}>
                        <td className="muted">{i + 1}</td>
                        <td><span className={`chip ${b.type === "full" ? "chip-blue" : "chip-purple"}`}>{b.type === "full" ? "Completo" : "Incremental"}</span></td>
                        <td>{fmtDate(b.createdAt)}</td>
                        <td>{(b.sizeBytes / 1048576).toFixed(1)} MB</td>
                        <td className="num-col">{b.counts.persons}</td><td className="num-col">{b.counts.documents}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                ) : <p className="empty">Aún no hay respaldos.</p>}
              </section>

              {restore && (
                <section className={`card verify ${restore.ok ? "ok" : "bad"}`}>
                  {restore.error ? <b>Error: {restore.error}</b> : (
                    <>
                      <div className="card-head">
                        <h2>{restore.ok ? "Restauración verificada" : "La restauración no coincide"}</h2>
                        <span className={`status ${restore.ok ? "ok" : "bad"}`}>{restore.ok ? "Correcta" : "Con diferencias"}</span>
                      </div>
                      <table className="cmp">
                        <thead><tr><th></th><th>Pacientes</th><th>Documentos</th><th>Ubicaciones</th></tr></thead>
                        <tbody>
                          <tr><td>Esperado (último respaldo)</td><td>{restore.expectedAtLastBackup.persons}</td><td>{restore.expectedAtLastBackup.documents}</td><td>{restore.expectedAtLastBackup.locations}</td></tr>
                          <tr className="hl"><td>Restaurado</td><td>{restore.restored.persons}</td><td>{restore.restored.documents}</td><td>{restore.restored.locations}</td></tr>
                          <tr><td>Base en operación</td><td>{restore.live.persons}</td><td>{restore.live.documents}</td><td>{restore.live.locations}</td></tr>
                        </tbody>
                      </table>
                      <p className="small muted">Últimos pacientes en la copia restaurada: {restore.lastPersons?.map((p: any) => p.full_name).join(", ")}</p>
                    </>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </div>

      {toast && (
        <button className={`toast ${toast.ok ? "ok" : "bad"}`} onClick={() => { setLogOpen(true); setToast(null); }}>
          <span className="t-icon"><Icon name={toast.ok ? "check" : "activity"} /></span>
          <span>{toast.title}</span>
          {toast.status && <span className="code">{toast.status}</span>}
        </button>
      )}

      {logOpen && <div className="overlay" onClick={() => setLogOpen(false)} />}
      <aside className={`drawer ${logOpen ? "open" : ""}`} aria-hidden={!logOpen}>
        <div className="card-head">
          <h2>Actividad</h2>
          <div className="row">
            {log.length > 0 && <button className="ghost sm" onClick={() => setLog([])}>Limpiar</button>}
            <button className="ghost sm" onClick={() => setLogOpen(false)}>Cerrar</button>
          </div>
        </div>
        {log.length === 0 && <p className="empty">Sin actividad en esta sesión.</p>}
        {log.map((e) => (
          <details key={e.id} className={e.ok ? "ok" : "bad"} open={e === log[0]}>
            <summary>
              <span className="time">{e.time}</span>
              {e.status && <span className={`code ${e.ok ? "ok" : "bad"}`}>{e.status}</span>}
              <span className="t">{e.title}</span>
            </summary>
            <pre>{typeof e.data === "string" ? e.data : JSON.stringify(e.data, null, 2)}</pre>
          </details>
        ))}
      </aside>
    </div>
  );
}
