# CLAUDE.md — Agente IA Inmobiliario · RE/MAX Data House

> Contexto para Claude Code. Leé esto antes de tocar el repo. Es la fuente de verdad de ESTE proyecto.

## Qué es

Bot conversacional de **WhatsApp** para **RE/MAX Data House** (agentes Daniela y Barby). Atiende leads de Meta Ads en **español rioplatense (voseo)**, califica en cascada, matchea con el catálogo, comparte links de RE/MAX con **código de referido**, agenda visitas y detecta **leads calientes** para alertar a la agente. **Multi-tenant** desde el día uno. Es un MVP camino a un SaaS.

## Stack

- **Node ≥ 20**, **TypeScript** (ESM; se corre con `tsx`, sin build en dev).
- **WhatsApp:** Baileys (fase de pruebas). Detrás de una interfaz de transporte intercambiable → Cloud API oficial es la Fase 2 (un adaptador nuevo, sin tocar el resto).
- **IA:** Vercel AI SDK v7 (`ai`) con Claude (`@ai-sdk/anthropic`) + **cadena de fallback** (OpenRouter / OpenAI).
- **Datos:** Supabase (Postgres). El bot lee/escribe con la **service role key** (server-side).
- **Catálogo:** sync por **API directa** contra el CRM de RE/MAX (`api-ar.redremax.com`).

## Mapa del repo

```
src/
  index.ts               Orquesta: una línea por agente, cola, turno, envío
  config.ts              Env + validación (validarConfig)
  agent/
    llm.ts               Cadena de modelos + fallback (conFallback/generateWithFallback)
    brain.ts             runAgentTurn (el AI SDK maneja el loop de tools)
    prompt.ts            Prompt EN CAPAS (componerSystemPrompt) + variables
    tools.ts             6 tools (tool() + Zod) + interfaz `Repos`
  transport/
    index.ts             Interfaz Transport + MensajeEntrante + crearTransport
    baileys.ts           Adaptador Baileys (QR, eco/handoff, envío de burbujas)
  whatsapp/              connection.ts, sender.ts (split |||), media.ts
  repositories/          ÚNICA capa que toca Supabase (agentes, propiedades, leads,
                         conversaciones, visitas, notas, review, notifier) + crearRepos
  review/                Revisión nocturna (nightly.ts + run.ts + promote.ts)
  services/queue.ts      Cola por número (debounce + serialización)
  sync/                  remaxApiSource.ts (cliente API), listingMapper.ts, remaxCatalogSync.ts, run.ts, preview.ts
  test/dryRun.ts         Test del núcleo (sin red)
prompts/system_prompt.txt  El "cerebro" (voseo, reglas, ejemplos)
supabase/migrations/       0001_init.sql + 0002_crm_lessons.sql
supabase/seed.sql          Agentes + propiedades de ejemplo
```

## Convenciones (no romper)

- **Voseo rioplatense estricto** en todo lo que ve el cliente. Cero "tú". El cerebro está en `prompts/system_prompt.txt`; se compone en capas en `agent/prompt.ts` (inicio + business_info + notas activas + memoria).
- **Mensajes fraccionados** con el token `|||`: el `sender` los parte en burbujas separadas.
- **Multi-tenant:** cada agente es una fila en `agentes`. **Un solo prompt**, cambian las variables. **Nada de valores de negocio hardcodeados** → van en la BD (`agentes.business_info`, `agent_notes`).
- **Anti-alucinación:** el agente SOLO habla de propiedades que devuelven las tools (Supabase). Si no tiene un dato, deriva; nunca inventa.
- **Repos = única capa que toca Supabase.** Las tools llaman repos vía la interfaz `Repos` (inyectada con `crearRepos`). No metas queries de Supabase fuera de `repositories/`.
- **Cadena de modelos con fallback** (`agent/llm.ts`): sin fallback, una cuota agotada deja el bot mudo. Cargar siempre ≥ 2 proveedores.
- **Handoff por eco:** si la agente responde a mano desde su celular, el bot se pausa solo (`leads.bot_pausado`).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` / `start` | Corre el bot |
| `npm test` | Test del núcleo (sin red) |
| `npm run typecheck` | **Correr SIEMPRE antes de pushear** (`next lint` no aplica; la verificación real es typecheck) |
| `npm run sync:preview` | Login a la API + imprime la estructura de una propiedad y su mapeo (sin DB) |
| `npm run sync:catalogo` | Login a la API del CRM → sincroniza el catálogo a Supabase |
| `npm run review` / `review:promote <id>` | Revisión nocturna y promover una nota a corrección activa |

## Integración RE/MAX (endpoints descubiertos)

El CRM `redremax.com` es una **Angular PWA con login SSO**. Endpoints reales:

- **Login (token):** `POST https://api-ar.redremax.com/auth/v1/qrlistings/login` (+ `/refresh`).
- **Listings:** `GET https://api-ar.redremax.com/listings/api/listings` (la UI filtra del lado del cliente).
- **Cambios:** `.../v1/webapi/propertieschanges` (útil para un sync incremental a futuro).
- **Agentes:** `secureservices.redremax.com/v1/webapi/directory`, `/agents/{code}`. Oficina: **AR.42.27**.
- **Imágenes:** `redremax-images.s3.amazonaws.com/listings/{uuid}/...`

El sync (`src/sync/remaxApiSource.ts`) hace `POST /auth/v1/qrlistings/login` con `REMAX_EMAIL`/`REMAX_PASSWORD`, y con el `id_token` que devuelve pagina `GET /listings/api/listings` (100 por página). El mapeo a `propiedades` vive en `listingMapper.ts` y upsertea por `codigo_remax`.

> **PENDIENTE / TODO:** calibrar `mapListing()` con el JSON real. Correr `npm run sync:preview`, mirar el `shape` que imprime y ajustar los nombres de campos (hoy el mapeo es tolerante pero "a ciegas").

## Seguridad (crítico)

- **NUNCA** commitear `.env` ni `auth/` (ya están en `.gitignore`). La `SUPABASE_SERVICE_ROLE_KEY` y las credenciales de RE/MAX son **solo server-side**.
- **Baileys no es oficial de WhatsApp:** usar números de prueba, sin envío masivo (riesgo de ban). Producción → Cloud API.
- **RLS activado** en todas las tablas (el bot usa service role, que la bypassa). Si algún día se usa la anon key desde cliente, agregar políticas.
- Queries siempre por el cliente de Supabase (parametrizadas); nada de SQL por interpolación.

## Estado y pendientes

**Hecho:** system prompt; bot v0.3 (multi-tenant, cadena de fallback, prompt en capas, handoff por eco, transporte intercambiable, revisión nocturna); esquema + seed; sync por API del CRM (673 propiedades, mapeo calibrado). Typecheck limpio, tests del núcleo en verde.

**Pendiente:**
1. Calibrar el mapeo del sync con datos reales (`sync:preview`).
2. Cargar datos reales de Daniela y Barby en `agentes` (código de referido, teléfono de alertas, matrícula, zonas).
3. Deploy 24/7 (VPS) + cron del `sync:catalogo`.
4. Fase 2: migración a WhatsApp Cloud API (adaptador `transport/cloud.ts`).
5. Transcripción de audios (hoy es stub en `whatsapp/media.ts`).
6. Confirmar el formato real del link con referido de RE/MAX (hoy `?ref=código`).

## Docs de referencia

- `docs/PROYECTO_INMO_IA.md` — documento maestro (visión, identidad, reglas de negocio).
- `STACK.md` / `SYSTEM.md` (fuera del repo) — arquitectura del **CRM previo** del que se tomaron lecciones. **No es la arquitectura de este repo**; este bot es standalone.
