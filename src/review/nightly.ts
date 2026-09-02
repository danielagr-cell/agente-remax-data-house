import { generateObject } from 'ai';
import { z } from 'zod';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { config } from '../config';
import { logger } from '../logger';
import { getAgentesActivos } from '../repositories/agentes';
import { getLeadsParaRevisar, getTranscript, guardarNotasRevision, marcarRevisado } from '../repositories/review';
import type { NotaRevision } from '../types';

const NotasSchema = z.object({
  notas: z.array(
    z.object({
      tipo: z.enum(['fallo', 'mejora']),
      severidad: z.enum(['baja', 'media', 'alta']),
      hallazgo: z.string(),
    }),
  ),
});

function modeloRevisor() {
  if (config.review.provider === 'openai' && config.openai.apiKey) {
    return createOpenAI({ apiKey: config.openai.apiKey })(config.review.model);
  }
  return createAnthropic({ apiKey: config.anthropic.apiKey })(config.review.model);
}

const SYSTEM_REVISOR = `Sos un auditor de calidad de una asesora inmobiliaria de RE/MAX que atiende por WhatsApp en español rioplatense (voseo).
Evaluás su desempeño en una conversación ya concluida contra estas reglas:
- Voseo estricto, tono ejecutivo cercano, mensajes cortos y fraccionados.
- Nunca inventar datos de propiedades.
- Ante un precio: darlo directo + un gancho de calificación.
- Compartir el link con referido cuando hay interés.
- Ofrecer 2 horarios concretos para la visita.
- Detectar y escalar el lead caliente.
Devolvé SOLO hallazgos accionables y concretos (tipo "fallo" = algo que hizo mal; "mejora" = una oportunidad). Si estuvo todo bien, devolvé la lista vacía.`;

export async function revisarConversacion(transcript: string): Promise<NotaRevision[]> {
  if (!transcript.trim()) return [];
  const { object } = await generateObject({
    model: modeloRevisor(),
    schema: NotasSchema,
    system: SYSTEM_REVISOR,
    prompt: `Conversación:\n\n${transcript}`,
  });
  return object.notas as NotaRevision[];
}

export async function correrRevisionNocturna(): Promise<{ leads: number; notas: number }> {
  const agentes = await getAgentesActivos();
  let totalLeads = 0;
  let totalNotas = 0;

  for (const agente of agentes) {
    const leads = await getLeadsParaRevisar(agente.id);
    for (const lead of leads) {
      totalLeads++;
      try {
        const transcript = await getTranscript(lead.id);
        const notas = await revisarConversacion(transcript);
        await guardarNotasRevision(agente.id, lead.id, notas);
        await marcarRevisado(lead.id, lead.ultima_interaccion);
        totalNotas += notas.length;
        logger.info(`Revisado lead ${lead.id}: ${notas.length} nota(s).`);
      } catch (e) {
        logger.error(`Falló la revisión del lead ${lead.id}: ${(e as Error).message}`);
      }
    }
  }

  logger.info(`Revisión nocturna terminada: ${totalLeads} leads, ${totalNotas} notas.`);
  return { leads: totalLeads, notas: totalNotas };
}
