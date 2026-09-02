-- ============================================================
--  RE/MAX Data House — Esquema multi-tenant
--  Correr en el proyecto Supabase dedicado (SQL Editor o CLI).
-- ============================================================

-- ============ AGENTES (tenants) ============
create table if not exists agentes (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  apellido          text,
  oficina           text not null default 'RE/MAX Data House',
  matricula         text,
  codigo_referido   text not null,
  whatsapp_numero   text not null unique,          -- número del bot para esta agente (E.164 sin +): 549111...
  telefono_alertas  text,                          -- celular personal para alertas de lead caliente
  zonas_cobertura   text[] not null default '{}',
  horario_atencion  text not null default 'Lun a Sáb, 9 a 19 h',
  activo            boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ============ PROPIEDADES (catálogo, espejo del CRM nacional RE/MAX) ============
create table if not exists propiedades (
  id                 uuid primary key default gen_random_uuid(),
  agente_id          uuid references agentes(id) on delete set null,  -- null = catálogo compartido
  codigo_remax       text unique,                  -- ID en el CRM de RE/MAX (clave del sync)
  operacion          text not null check (operacion in ('venta','alquiler','alquiler_temporario')),
  tipo               text not null check (tipo in ('departamento','casa','ph','monoambiente','terreno','local','oficina','cochera','galpon')),
  titulo             text not null,
  zona               text not null,
  direccion          text,
  precio             numeric,
  moneda             text not null default 'USD' check (moneda in ('USD','ARS')),
  ambientes          int,
  dormitorios        int,
  banos              int,
  cochera            boolean default false,
  metros_cubiertos   numeric,
  metros_totales     numeric,
  expensas           numeric,
  orientacion        text,
  apto_credito       boolean,
  a_estrenar         boolean,
  extras             text[] not null default '{}',
  descripcion        text,
  link_oficial       text,                          -- link base RE/MAX (sin referido); el referido se agrega al servir
  estado             text not null default 'disponible' check (estado in ('disponible','reservada','vendida','pausada')),
  actualizado_crm_at timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists idx_prop_busqueda on propiedades (operacion, tipo, zona, estado);
create index if not exists idx_prop_precio on propiedades (precio);

-- ============ LEADS (CRM) ============
create table if not exists leads (
  id                 uuid primary key default gen_random_uuid(),
  agente_id          uuid not null references agentes(id) on delete cascade,
  telefono           text not null,                 -- WhatsApp del cliente (E.164 sin +)
  nombre             text,
  operacion          text,
  tipo_buscado       text,
  zonas_interes      text[] not null default '{}',
  presupuesto_max    numeric,
  moneda             text default 'USD',
  motivo             text check (motivo in ('vivienda','inversion','mudanza','upgrade','otro')),
  urgencia           text check (urgencia in ('exploratoria','media','alta')),
  temperatura        text not null default 'frio' check (temperatura in ('frio','tibio','caliente')),
  estado_funnel      text not null default 'nuevo',
  origen             text,                          -- ej: 'Meta Ads - anuncio depto Caballito'
  notas              text,
  bot_pausado        boolean not null default false,-- true = intervención humana en curso
  ultima_interaccion timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  unique (agente_id, telefono)
);
create index if not exists idx_leads_temp on leads (agente_id, temperatura);

-- ============ CONVERSACIONES (memoria) ============
create table if not exists conversaciones (
  id          bigint generated always as identity primary key,
  lead_id     uuid not null references leads(id) on delete cascade,
  agente_id   uuid not null references agentes(id) on delete cascade,
  rol         text not null check (rol in ('user','assistant','tool')),
  contenido   text,
  tipo_media  text not null default 'texto',        -- texto | audio | imagen | video
  meta        jsonb,                                -- tool calls / resultados / adjuntos
  created_at  timestamptz not null default now()
);
create index if not exists idx_conv_lead on conversaciones (lead_id, created_at);

-- ============ DISPONIBILIDAD (agenda de la agente) ============
create table if not exists disponibilidad (
  id          uuid primary key default gen_random_uuid(),
  agente_id   uuid not null references agentes(id) on delete cascade,
  inicio      timestamptz not null,
  fin         timestamptz not null,
  disponible  boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_disp on disponibilidad (agente_id, inicio, disponible);

-- ============ VISITAS ============
create table if not exists visitas (
  id            uuid primary key default gen_random_uuid(),
  agente_id     uuid not null references agentes(id) on delete cascade,
  lead_id       uuid not null references leads(id) on delete cascade,
  propiedad_id  uuid references propiedades(id) on delete set null,
  slot_id       uuid references disponibilidad(id) on delete set null,
  fecha_hora    timestamptz not null,
  estado        text not null default 'agendada' check (estado in ('agendada','confirmada','realizada','cancelada')),
  nombre_cliente text,
  notas         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_visitas on visitas (agente_id, fecha_hora);

-- ============ SEGURIDAD (RLS) ============
-- El bot se conecta con la SERVICE ROLE KEY (bypassa RLS), así que sigue funcionando.
-- Activamos RLS sin políticas para que la anon key NO pueda leer/escribir nada.
-- Si más adelante usás la anon key desde un cliente, agregá políticas específicas.
alter table agentes        enable row level security;
alter table propiedades    enable row level security;
alter table leads          enable row level security;
alter table conversaciones enable row level security;
alter table disponibilidad enable row level security;
alter table visitas        enable row level security;
