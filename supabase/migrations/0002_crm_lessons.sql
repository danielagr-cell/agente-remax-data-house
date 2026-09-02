-- ============================================================
--  0002 — Lecciones del CRM: prompt en capas + bucle de mejora
--  Correr DESPUÉS de 0001_init.sql.
-- ============================================================

-- Prompt en capas: tono e info de negocio editables por agente.
alter table agentes add column if not exists tono text;
alter table agentes add column if not exists business_info jsonb not null default '{}'::jsonb;

-- Correcciones activas: se inyectan en el prompt de cada conversación.
create table if not exists agent_notes (
  id         uuid primary key default gen_random_uuid(),
  agente_id  uuid not null references agentes(id) on delete cascade,
  contenido  text not null,
  activa     boolean not null default true,
  origen     text not null default 'manual', -- manual | revision
  created_at timestamptz not null default now()
);
create index if not exists idx_agent_notes on agent_notes (agente_id, activa);

-- Hallazgos de la revisión nocturna.
create table if not exists agent_review_notes (
  id         uuid primary key default gen_random_uuid(),
  agente_id  uuid not null references agentes(id) on delete cascade,
  lead_id    uuid references leads(id) on delete set null,
  tipo       text not null check (tipo in ('fallo','mejora')),
  severidad  text not null default 'media' check (severidad in ('baja','media','alta')),
  hallazgo   text not null,
  estado     text not null default 'nueva' check (estado in ('nueva','aplicada','descartada')),
  created_at timestamptz not null default now()
);
create index if not exists idx_review_notes on agent_review_notes (agente_id, estado);

-- Qué lead ya se revisó (evita re-analizar sin actividad nueva).
create table if not exists agent_review_log (
  lead_id        uuid primary key references leads(id) on delete cascade,
  revisado_hasta timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

alter table agent_notes        enable row level security;
alter table agent_review_notes enable row level security;
alter table agent_review_log   enable row level security;
