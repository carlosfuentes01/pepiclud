-- Esquema PepiCloud: personas, tipos documentales, metadatos y referencias de almacenamiento.
-- Los archivos NO se guardan aquí (sin BLOB/bytea): solo su ubicación en S3.

CREATE TABLE persons (
  id              SERIAL PRIMARY KEY,
  document_number VARCHAR(30)  NOT NULL UNIQUE,   -- identificación única de la persona
  full_name       VARCHAR(150) NOT NULL,
  birth_date      DATE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE document_types (
  id   SERIAL PRIMARY KEY,
  code VARCHAR(20)  NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE documents (
  id            UUID PRIMARY KEY,
  person_id     INT NOT NULL REFERENCES persons(id),
  type_id       INT NOT NULL REFERENCES document_types(id),
  title         VARCHAR(200) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(100) NOT NULL,
  size_bytes    BIGINT NOT NULL,
  sha256        CHAR(64) NOT NULL,          -- huella del archivo original (integridad)
  iv            VARCHAR(32) NOT NULL,       -- vector de inicialización AES-GCM (hex)
  auth_tag      VARCHAR(32) NOT NULL,       -- etiqueta de autenticación AES-GCM (hex)
  retain_until  TIMESTAMPTZ NOT NULL,       -- fin del período de inmutabilidad
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

-- Las tres ubicaciones de cada documento: 2 copias operativas + 1 backup.
CREATE TABLE document_locations (
  document_id UUID NOT NULL REFERENCES documents(id),
  role        VARCHAR(10) NOT NULL CHECK (role IN ('primary','secondary','backup')),
  bucket      VARCHAR(63)  NOT NULL,
  object_key  VARCHAR(300) NOT NULL,
  version_id  VARCHAR(100) NOT NULL,
  etag        VARCHAR(100),
  PRIMARY KEY (document_id, role)
);

CREATE INDEX idx_documents_person ON documents(person_id);

INSERT INTO document_types (code, name) VALUES
  ('HC',  'Historia clínica'),
  ('LAB', 'Resultado de laboratorio'),
  ('IMG', 'Imagen diagnóstica'),
  ('FOR', 'Fórmula médica');
