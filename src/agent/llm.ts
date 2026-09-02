import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, stepCountIs } from 'ai';
import { config } from '../config';
import { logger } from '../logger';

export interface ModeloEntry {
  nombre: string;
  crear: () => any; // LanguageModel del AI SDK
}

/** Arma la cadena de modelos según las keys presentes, encabezada por AGENT_PRIMARY. */
export function modelChain(): ModeloEntry[] {
  const entradas: Record<'anthropic' | 'openrouter' | 'openai' | 'google', ModeloEntry | null> = {
    anthropic: config.anthropic.apiKey
      ? {
          nombre: `anthropic:${config.anthropic.model}`,
          crear: () => createAnthropic({ apiKey: config.anthropic.apiKey })(config.anthropic.model),
        }
      : null,
    openrouter: config.openrouter.apiKey
      ? {
          nombre: `openrouter:${config.openrouter.model}`,
          crear: () =>
            createOpenAI({ apiKey: config.openrouter.apiKey, baseURL: 'https://openrouter.ai/api/v1' })(
              config.openrouter.model,
            ),
        }
      : null,
    openai: config.openai.apiKey
      ? { nombre: `openai:${config.openai.model}`, crear: () => createOpenAI({ apiKey: config.openai.apiKey })(config.openai.model) }
      : null,
    google: config.google.apiKey
      ? {
          nombre: `google:${config.google.model}`,
          crear: () => createGoogleGenerativeAI({ apiKey: config.google.apiKey })(config.google.model),
        }
      : null,
  };

  const orden = ([config.agentPrimary, 'anthropic', 'openrouter', 'openai', 'google'] as const).filter(
    (v, i, a) => a.indexOf(v) === i,
  );
  return orden.map((k) => entradas[k]).filter((e): e is ModeloEntry => e !== null);
}

const TRANSITORIOS = new Set([408, 409, 429, 500, 502, 503, 504]);

export function esTransitorio(err: any): boolean {
  const status = err?.statusCode ?? err?.status ?? err?.response?.status;
  if (typeof status === 'number' && TRANSITORIOS.has(status)) return true;
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('overloaded') ||
    msg.includes('socket hang up')
  );
}

export function esCuotaOKeyInvalida(err: any): boolean {
  const status = err?.statusCode ?? err?.status ?? err?.response?.status;
  if (status === 401 || status === 403) return true;
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  return (
    msg.includes('quota') ||
    msg.includes('insufficient') ||
    msg.includes('billing') ||
    msg.includes('credit') ||
    msg.includes('invalid api key') ||
    msg.includes('unauthorized')
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface GenResult {
  text: string;
  steps: any[];
  modelo: string;
}

/**
 * Recorre la cadena de modelos: hasta 3 intentos por modelo ante errores
 * transitorios (429/503/socket) con espera creciente; ante cuota agotada o key
 * inválida salta directo al siguiente. Aislada de la llamada real para testear.
 */
export async function conFallback(
  chain: ModeloEntry[],
  intentar: (entry: ModeloEntry) => Promise<GenResult>,
): Promise<GenResult> {
  if (chain.length === 0) throw new Error('Sin modelos configurados: cargá al menos ANTHROPIC_API_KEY.');
  let ultimo: unknown;
  for (const entry of chain) {
    for (let intento = 1; intento <= 3; intento++) {
      try {
        return await intentar(entry);
      } catch (err) {
        ultimo = err;
        if (esCuotaOKeyInvalida(err)) {
          logger.warn(`${entry.nombre}: cuota agotada o key inválida → salto al siguiente modelo.`);
          break;
        }
        if (esTransitorio(err) && intento < 3) {
          await sleep(300 * intento);
          continue;
        }
        logger.warn(`${entry.nombre}: error → siguiente modelo (${(err as Error)?.message ?? err}).`);
        break;
      }
    }
  }
  throw new Error(`Todos los modelos fallaron. Último error: ${(ultimo as Error)?.message ?? ultimo}`);
}

export interface GenArgs {
  system: string;
  messages: any[];
  tools?: any;
  maxSteps?: number;
  temperature?: number;
  maxOutputTokens?: number;
}

export async function generateWithFallback(args: GenArgs): Promise<GenResult> {
  return conFallback(modelChain(), async (entry) => {
    const r = await generateText({
      model: entry.crear(),
      system: args.system,
      messages: args.messages,
      tools: args.tools,
      stopWhen: stepCountIs(args.maxSteps ?? config.bot.maxToolIterations),
      temperature: args.temperature ?? config.bot.temperature,
      maxOutputTokens: args.maxOutputTokens ?? config.bot.maxOutputTokens,
    });
    return { text: r.text ?? '', steps: (r.steps as any[]) ?? [], modelo: entry.nombre };
  });
}
