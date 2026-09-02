# RE/MAX Data House — Agente IA para WhatsApp (MVP endurecido · v0.2)

Bot conversacional inmobiliario para WhatsApp. Atiende leads de Meta Ads, califica en cascada, hace matching con el catálogo, comparte links de RE/MAX con código de referido, agenda visitas y detecta leads calientes. Multi-tenant desde el día uno.

**v0.2** suma las lecciones de producción del CRM previo: cadena de modelos con fallback, prompt en capas, handoff automático por eco, transporte intercambiable y revisión nocturna que mejora el prompt sola.

**Stack:** Node.js + TypeScript · [Baileys](https://github.com/WhiskeySockets/Baileys) (WhatsApp) · [Vercel AI SDK](https://sdk.vercel.ai/) (Claude + fallback) · Supabase (Postgres).

---

## Requisitos

- Node.js **>= 20**
- Un proyecto **Supabase** dedicado
- **Al menos una** API key de modelo (idealmente **dos** para el fallback: Anthropic + OpenRouter/OpenAI)
- Un número de WhatsApp de **prueba** para vincular por QR

---

## Puesta en marcha (5 pasos)

### 1. Base de datos (Supabase → SQL Editor, en orden)

1. `supabase/migrations/0001_init.sql`
2. `supabase/migrations/0002_crm_lessons.sql`
3. `supabase/seed.sql` (agentes de ejemplo + propiedades + business_info + una nota)

### 2. Variables de entorno

```bash
cp .env.example .env
```

Completá el mínimo: `ANTHROPIC_API_KEY` (+ un fallback como `OPENROUTER_API_KEY`), `ANTHROPIC_MODEL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

> ⚠️ **Cargá al menos dos proveedores de modelo.** Sin fallback, una cuota agotada deja el bot mudo en producción.

### 3. Instalar

```bash
npm install
```

### 4. Correr

```bash
npm run dev
```

### 5. Vincular WhatsApp

La terminal muestra un **QR por cada agente activa**. En el celular: WhatsApp → **Dispositivos vinculados** → **Vincular un dispositivo**. La sesión queda en `auth/<agente_id>/` y no vuelve a pedir QR.

---

## Cómo funciona

```
WhatsApp  →  Transporte (Baileys)  →  normaliza a MensajeEntrante
   → ¿es eco de la agente (respuesta manual)?  → pausa el bot para ese lead
   → cola por número (agrupa mensajes rápidos, anti-duplicados)
   → arma el System Prompt EN CAPAS (negocio + inicio + business_info + notas activas + memoria)
   → Claude en loop con tools, con CADENA DE MODELOS + FALLBACK
        buscar_propiedades · obtener_detalle · guardar_perfil_lead
        consultar_disponibilidad · agendar_visita · alertar_agente_humano
   → guarda la conversación (memoria) en Supabase
   → parte la respuesta en burbujas (|||) y las envía con "escribiendo…"

(de madrugada)  →  revisión nocturna: evalúa charlas concluidas → notas → correcciones
```

### Lecciones del CRM incorporadas (v0.2)

- **Cadena de modelos con fallback** (`src/agent/llm.ts`): primario + respaldo (mismo modelo, billetera aparte vía OpenRouter, u OpenAI). Reintenta ante errores transitorios (429/503/socket) con espera creciente; ante cuota agotada o key inválida salta directo al siguiente. Evita el "bot mudo".
- **Prompt en capas** (`src/agent/prompt.ts`): base del negocio + bloque de inicio (charla nueva vs en curso) + `business_info` editable + **notas de corrección activas** que se inyectan en cada conversación + memoria del lead.
- **Handoff automático por eco**: si la agente responde manualmente desde su celular, el bot lo detecta (mensaje `fromMe` que no envió él) y **se pausa solo** para ese lead. Los ecos de los propios mensajes del bot se deduplican.
- **Transporte intercambiable** (`src/transport/`): interfaz única; hoy Baileys, mañana Cloud API como drop-in (ahí vive la ventana de 24 h y las plantillas aprobadas). El resto del sistema no sabe qué proveedor está activo.
- **Revisión nocturna** (`src/review/`): evalúa las conversaciones concluidas contra las reglas con un modelo barato, guarda hallazgos (`agent_review_notes`) y permite **promover** una nota a corrección activa del prompt.

---

## El catálogo real (sync con el CRM de RE/MAX)

El bot **nunca inventa** propiedades: solo habla de lo que hay en la tabla `propiedades`, espejo del CRM. El sync (`src/sync/remaxApiSource.ts`) las trae del CRM de RE/MAX (`api-ar.redremax.com`) por **API directa**: login con las credenciales de la agente y descarga paginada del catálogo con el token que devuelve.

2. Cargá tus credenciales en `.env`: `REMAX_EMAIL`, `REMAX_PASSWORD`.
3. Corré `npm run sync:catalogo`.

**Qué hace:** `POST api-ar.redremax.com/auth/v1/qrlistings/login` con tus credenciales, toma el `id_token` de la respuesta y con él pagina `GET api-ar.redremax.com/listings/api/listings` (100 por página, solo las activas de la agente). Después mapea cada listing a la tabla `propiedades` y la upsertea por `codigo_remax`. Sin navegador: no depende de los selectores del front.

**Primera corrida (calibración):** el mapeo de campos es tolerante pero se **afina con datos reales**. La primera corrida loguea las claves del primer listing (`Claves del primer listing: ...`); si el login falla, deja un screenshot en `auth/remax-debug.png` para ajustar los selectores. Pasame ese log o la imagen y lo termino de calibrar.

**Endpoints del CRM descubiertos** (referencia): login `api-ar.redremax.com/auth/v1/qrlistings/login`, listings `api-ar.redremax.com/listings/api/listings`, cambios `.../v1/webapi/propertieschanges` (para sync incremental a futuro), agentes `secureservices.redremax.com/v1/webapi/directory`.

Ideal correrlo con un cron / scheduled task (ej. cada 1-2 h).

---

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Bot con recarga en caliente |
| `npm start` | Bot |
| `npm test` | Test del núcleo (fallback, prompt en capas, tools, split) — sin red |
| `npm run typecheck` | Chequeo de tipos |
| `npm run sync:preview` | Login a la API + imprime la estructura de una propiedad y su mapeo (sin DB) |
| `npm run sync:catalogo` | Login a la API del CRM y sincroniza el catálogo a Supabase |
| `npm run review` | Revisión nocturna (ideal como cron diario) |
| `npm run review:promote <id>` | Promueve una nota de revisión a corrección activa |

---

## Estructura

```
src/
  index.ts               Orquesta: una línea por agente, cola, turno, envío
  config.ts              Env + validación (cadena de modelos, transporte)
  agent/
    llm.ts               Cadena de modelos + fallback (reintentos/salto)
    brain.ts             Turno del agente (AI SDK maneja el loop de tools)
    prompt.ts            Prompt EN CAPAS + inyección de variables
    tools.ts             6 tools (tool() + Zod) + contrato de repos
  transport/
    index.ts             Interfaz de transporte + MensajeEntrante
    baileys.ts           Adaptador Baileys (QR, eco/handoff, envío)
  whatsapp/              Conexión, split de burbujas, media (helpers de Baileys)
  repositories/          Supabase: agentes, propiedades, leads, conversaciones,
                         visitas, notas (correcciones), review, alertas
  review/                Revisión nocturna: nightly.ts + run.ts + promote.ts
  services/queue.ts      Cola por número (debounce + serialización)
  sync/                  Adaptador de sincronización con el CRM de RE/MAX
prompts/system_prompt.txt  El cerebro del agente (voseo, reglas, ejemplos)
supabase/                  Migraciones (0001, 0002) + seed
```

---

## Notas importantes

- **Baileys no es oficial de WhatsApp.** Usá un número de prueba, sin envío masivo. Para producción con garantías, la ruta es la **WhatsApp Cloud API** (Fase 2): se implementa como un transporte nuevo en `src/transport/cloud.ts`, sin tocar el resto.
- **Seguridad:** `auth/` y `.env` están en `.gitignore`. Nunca subas la `SERVICE_ROLE_KEY` ni la expongas en cliente.
- **Costos de Claude:** activá **prompt caching** sobre el System Prompt (largo y repetido). La revisión nocturna usa un modelo barato aparte (`REVIEW_MODEL`).
- **Reactivar un lead pausado:** poné `bot_pausado = false` en la fila del lead. Si la agente tomó el chat por eco, se pausó solo; reactivalo cuando quieras que el bot vuelva.
- **Transcripción de audios:** stub en `src/whatsapp/media.ts` (`TRANSCRIPCION_PROVIDER=none`). Enchufá Groq/OpenAI Whisper cuando quieras.

---

*MVP v0.2 — RE/MAX Data House. El System Prompt (cerebro) está en `prompts/system_prompt.txt`.*
