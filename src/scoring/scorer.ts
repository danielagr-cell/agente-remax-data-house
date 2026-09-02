import { generateObject } from 'ai';
import { z } from 'zod';
import { logger } from '../logger';
import type { Agente, Lead } from '../types';
import type { PerfilPatch, Repos } from '../agent/tools';
import { getTranscript } from '../repositories/review';
import { modelChain } from '../agent/llm';

const ScoreSchema = z.object({
  temperatura: z.enum(['frio', 'tibio', 'caliente']),
  presupuesto_max: z.number().nullable(),
  urgencia: z.enum(['exploratoria', 'media', 'alta']).nullable(),
  motivo: z.enum(['vivienda', 'inversion', 'mudanza', 'upgrade', 'otro']).nullable(),
  razones: z.string(),
});
type Score = z.infer<typeof ScoreSchema>;

const SYSTEM_SCORER = `Sos un analista de leads inmobiliarios. Leés una conversación de WhatsApp entre una asesora de RE/MAX y un cliente, y clasificás al cliente.
Temperatura:
- frio: curiosea, sin presupuesto ni tiempos definidos.
- tibio: presupuesto o zona definidos, interés real, sin urgencia.
- caliente: presupuesto definido + urgencia + interés concreto (quiere visitar/comprar pronto: "tengo la plata", "me mudo en X semanas", "necesito cerrar ya").
Devolvé la clasificación, el presupuesto/urgencia/motivo si surgen (o null), y una razón corta de una frase. Si no hay datos, temperatura=frio.`;

/**
 * Puntúa un lead recorriendo la MISMA cadena de modelos que el agente principal
 * (encabezada por AGENT_PRIMARY). Así el scorer nunca queda mudo porque una key
 * esté caída: si el primer proveedor falla, prueba el siguiente. Corre en fondo,
 * de a un intento por proveedor (no reintenta transitorios; la próxima vuelta lo hace).
 */
async function puntuar(transcript: string): Promise<Score> {
  const chain = modelChain();
  if (chain.length === 0) throw new Error('Scorer sin modelos disponibles: cargá al menos una API key.');
  let ultimo: unknown;
  for (const entry of chain) {
    try {
      const { object } = await generateObject({
        model: entry.crear(),
        schema: ScoreSchema,
        system: SYSTEM_SCORER,
        prompt: `Conversación:\n\n${transcript}`,
      });
      return object;
    } catch (e) {
      ultimo = e;
      logger.warn(`scorer ${entry.nombre}: ${(e as Error)?.message ?? e} → siguiente modelo.`);
    }
  }
  throw new Error(`Scorer: todos los modelos fallaron. Último: ${(ultimo as Error)?.message ?? ultimo}`);
}

export interface ScorerDeps {
  agente: Agente;
  repos: Pick<Repos, 'guardarPerfilLead' | 'alertarAgenteHumano'>;
}

/**
 * Sub-agente de fondo. Tras cada turno puntúa el lead (temperatura, presupuesto,
 * urgencia, motivo) y, si detecta CALIENTE por primera vez, dispara la alerta a
 * la agente (WhatsApp vía el notifier, que ya está cableado).
 *
 * Corre en silencio y NUNCA frena la respuesta al cliente: se invoca
 * fire-and-forget desde el orquestador. Solo alerta en la TRANSICIÓN a caliente,
 * así no re-alerta en cada mensaje ni pisa la alerta que ya pudo mandar el bot.
 */
export async function evaluarLead(deps: ScorerDeps, lead: Lead): Promise<void> {
  const transcript = await getTranscript(lead.id);
  if (!transcript.trim()) return;

  const tempPrevia = lead.temperatura;
  const object = await puntuar(transcript);

  // Actualizar el perfil del lead (silencioso). Solo pisamos lo que el scorer sí infirió.
  const patch: PerfilPatch = { temperatura: object.temperatura };
  if (object.presupuesto_max != null) patch.presupuesto_max = object.presupuesto_max;
  if (object.urgencia != null) patch.urgencia = object.urgencia;
  if (object.motivo != null) patch.motivo = object.motivo;
  await deps.repos.guardarPerfilLead(lead, patch);
  lead.temperatura = object.temperatura;

  // Alerta solo cuando recién ahora se vuelve caliente.
  if (object.temperatura === 'caliente' && tempPrevia !== 'caliente') {
    logger.info(`🔥 [${deps.agente.nombre}] lead +${lead.telefono} CALIENTE (scorer) → alerta.`);
    await deps.repos.alertarAgenteHumano(deps.agente, lead, {
      tipo: 'lead_caliente',
      resumen: object.razones,
      temperatura: 'caliente',
    });
  }
}
