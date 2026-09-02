import 'dotenv/config';

function numero(nombre: string, porDefecto: number): number {
  const v = process.env[nombre];
  if (!v) return porDefecto;
  const n = Number(v);
  return Number.isFinite(n) ? n : porDefecto;
}

function bool(nombre: string, porDefecto: boolean): boolean {
  const v = process.env[nombre];
  if (v === undefined) return porDefecto;
  return v === '1' || v.toLowerCase() === 'true';
}

// Config SIN efectos secundarios: no lanza al importar (así el test puede importar
// módulos que dependen de config sin tener .env). La validación real vive en
// validarConfig() y en db/supabase.ts, que corren en tiempo de ejecución.
export const config = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    model: process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4-5',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o',
  },
  google: {
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '',
    model: process.env.GOOGLE_MODEL ?? 'gemini-flash-latest',
  },
  // cuál encabeza la cadena de modelos: 'anthropic' | 'openrouter' | 'openai' | 'google'
  agentPrimary: (process.env.AGENT_PRIMARY ?? 'anthropic') as 'anthropic' | 'openrouter' | 'openai' | 'google',
  // modelo barato para autorrevisión y revisión nocturna
  review: {
    provider: (process.env.REVIEW_PROVIDER ?? 'anthropic') as 'anthropic' | 'openai',
    model: process.env.REVIEW_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
  },
  supabase: {
    url: process.env.SUPABASE_URL ?? '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  },
  bot: {
    splitToken: process.env.MENSAJE_SPLIT_TOKEN ?? '|||',
    typingMinMs: numero('TYPING_MIN_MS', 700),
    typingMaxMs: numero('TYPING_MAX_MS', 2500),
    debounceMs: numero('DEBOUNCE_MS', 2500),
    maxToolIterations: numero('MAX_TOOL_ITERATIONS', 8),
    maxOutputTokens: numero('MAX_OUTPUT_TOKENS', 1024),
    temperature: numero('AGENT_TEMPERATURE', 0.3),
    reflect: bool('AGENT_REFLECT', false),
  },
  transcripcion: {
    provider: (process.env.TRANSCRIPCION_PROVIDER ?? 'none') as 'none' | 'groq' | 'openai',
    apiKey: process.env.TRANSCRIPCION_API_KEY ?? '',
  },
  whatsappTransport: (process.env.WHATSAPP_TRANSPORT ?? 'baileys') as 'baileys' | 'cloud',
  // Credenciales por defecto de la Cloud API (para un solo numero; multi-tenant va en business_info.cloud del agente)
  whatsappCloud: {
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION ?? 'v20.0',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    token: process.env.WHATSAPP_CLOUD_TOKEN ?? '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? '',
  },
  // Sync del catálogo desde el CRM de RE/MAX vía cliente HTTP directo de su API.
  remax: {
    apiUrl: process.env.REMAX_API_URL ?? 'https://api-ar.redremax.com',
    email: process.env.REMAX_EMAIL ?? '',
    password: process.env.REMAX_PASSWORD ?? '',
  },
};

export type Config = typeof config;

/** Valida lo mínimo para arrancar en producción. Llamar en main() y en scripts. */
export function validarConfig(): void {
  const faltan: string[] = [];
  if (!config.supabase.url) faltan.push('SUPABASE_URL');
  if (!config.supabase.serviceKey) faltan.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!config.anthropic.apiKey && !config.openai.apiKey && !config.openrouter.apiKey && !config.google.apiKey) {
    faltan.push('al menos una API key de modelo (ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY)');
  }
  if (faltan.length > 0) {
    throw new Error(`Falta configurar: ${faltan.join(', ')}. Mirá .env.example.`);
  }
  if (!config.anthropic.apiKey && !config.openrouter.apiKey && config.openai.apiKey) {
    // solo un proveedor: el sistema funciona, pero sin red de seguridad.
    console.warn('⚠️  Un solo proveedor de modelo configurado: sin fallback, una cuota agotada deja el bot mudo.');
  }
}
