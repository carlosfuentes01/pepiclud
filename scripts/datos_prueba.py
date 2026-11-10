#!/usr/bin/env python3
"""Carga datos de prueba en PepiCloud a través de la API (como lo haría un usuario).

Crea personas, un tipo documental adicional y documentos médicos en PDF (ficticios).
Cada documento pasa por el flujo real: cifrado + 2 copias operativas + backup + Object Lock.

Uso:  python3 scripts/datos_prueba.py            (BASE_URL por defecto http://localhost:3000)
Se puede ejecutar varias veces: las personas existentes se reutilizan.
"""
import json
import os
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("BASE_URL", "http://localhost:3000")

PERSONAS = [
    ("1001234567", "María Fernanda Gómez", "1985-03-12"),
    ("1002345678", "Juan Carlos Pérez", "1978-11-05"),
    ("1003456789", "Luisa Martínez Ríos", "1992-07-21"),
    ("1004567890", "Andrés Felipe Herrera", "2001-01-30"),
    ("1005678901", "Carmen Rosa Díaz", "1960-09-14"),
]

# (identificación, código de tipo, título, líneas del informe)
DOCUMENTOS = [
    ("1001234567", "HC", "Historia clínica de ingreso", [
        "Motivo de consulta: cefalea persistente de 5 días.",
        "Antecedentes: hipertensión arterial controlada.",
        "Examen físico: TA 130/85 mmHg, FC 78 lpm, afebril.",
        "Plan: control de tensión y cita de seguimiento en 15 días."]),
    ("1001234567", "LAB", "Hemograma completo", [
        "Hemoglobina: 13.8 g/dL (12.0 - 16.0)",
        "Leucocitos: 7.200 /uL (4.500 - 11.000)",
        "Plaquetas: 265.000 /uL (150.000 - 450.000)",
        "Conclusión: valores dentro de rangos de referencia."]),
    ("1002345678", "IMG", "Radiografía de tórax PA", [
        "Técnica: proyección posteroanterior en bipedestación.",
        "Hallazgos: campos pulmonares sin consolidaciones.",
        "Silueta cardiaca de tamaño normal.",
        "Impresión diagnóstica: estudio dentro de límites normales."]),
    ("1002345678", "FOR", "Fórmula médica - control", [
        "Losartán 50 mg: 1 tableta cada 12 horas por 30 días.",
        "Hidroclorotiazida 25 mg: 1 tableta diaria por 30 días.",
        "Recomendaciones: dieta baja en sodio y actividad física."]),
    ("1003456789", "LAB", "Glicemia en ayunas", [
        "Glucosa en ayunas: 92 mg/dL (70 - 100)",
        "Hemoglobina glicosilada (HbA1c): 5.3 %",
        "Conclusión: sin evidencia de alteración glucémica."]),
    ("1004567890", "CONS", "Consentimiento informado - procedimiento", [
        "Procedimiento: extracción de cordales inferiores.",
        "El paciente declara haber recibido información sobre riesgos y alternativas.",
        "Firma del paciente y del profesional tratante registradas."]),
    ("1005678901", "HC", "Historia clínica - control crónico", [
        "Diagnóstico: diabetes mellitus tipo 2 en tratamiento.",
        "Evolución: adherente al tratamiento, sin hipoglucemias.",
        "Plan: continuar metformina 850 mg cada 12 horas."]),
]


def pdf(titulo: str, persona: str, ident: str, lineas: list[str]) -> bytes:
    """Genera un PDF de una página (Helvetica, WinAnsi) sin dependencias externas."""
    def esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    texto = [("F2", 18, "PepiCloud - Documento clínico (DATOS FICTICIOS)"), ("F2", 14, titulo),
             ("F1", 11, f"Paciente: {persona}   Identificación: {ident}"), ("F1", 11, "")]
    texto += [("F1", 11, l) for l in lineas]
    ops, y = ["BT"], 760
    for fuente, tam, linea in texto:
        ops.append(f"/{fuente} {tam} Tf 1 0 0 1 60 {y} Tm ({esc(linea)}) Tj")
        y -= tam + 12
    ops.append("ET")
    contenido = "\n".join(ops).encode("cp1252")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(contenido) + contenido + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % off for off in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


def call(method: str, path: str, body: bytes | None = None, ctype: str | None = None):
    req = urllib.request.Request(BASE + path, data=body, method=method)
    if ctype:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def post_json(path: str, data: dict):
    return call("POST", path, json.dumps(data).encode(), "application/json")


def post_multipart(path: str, fields: dict, filename: str, content: bytes, mime: str):
    b = uuid.uuid4().hex
    parts = [f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields.items()]
    parts.append(f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                 f"Content-Type: {mime}\r\n\r\n".encode() + content + b"\r\n")
    parts.append(f"--{b}--\r\n".encode())
    return call("POST", path, b"".join(parts), f"multipart/form-data; boundary={b}")


def main():
    # Tipo documental adicional
    st, _ = post_json("/api/document-types", {"code": "CONS", "name": "Consentimiento informado"})
    print(f"Tipo CONS: {'creado' if st == 200 else 'ya existía'}")
    tipos = {t["code"]: t["id"] for t in call("GET", "/api/document-types")[1]}

    # Personas (se reutilizan si ya existen)
    for ident, nombre, nac in PERSONAS:
        st, r = post_json("/api/persons", {"documentNumber": ident, "fullName": nombre, "birthDate": nac})
        print(f"Persona {ident} {nombre}: {'creada' if st == 200 else 'ya existía'}")
    personas = {p["document_number"]: p for p in call("GET", "/api/persons")[1]}

    # Documentos
    for ident, tipo, titulo, lineas in DOCUMENTOS:
        p = personas[ident]
        nombre_archivo = titulo.lower().replace(" ", "_").replace("-", "").replace("__", "_") + ".pdf"
        st, r = post_multipart("/api/documents", {"personId": p["id"], "typeId": tipos[tipo], "title": titulo},
                               nombre_archivo, pdf(titulo, p["full_name"], ident, lineas), "application/pdf")
        estado = f"OK id={r['id']}" if st == 200 else f"ERROR {st}: {r}"
        print(f"Documento [{tipo}] {titulo} ({p['full_name']}): {estado}")

    print("\nListo. Los documentos quedan protegidos 30 min (Object Lock COMPLIANCE) desde este momento.")


if __name__ == "__main__":
    main()
