import { supabase } from '../db/supabase';
import type { NotaRevision } from '../types';

export interface LeadRevisable {
  id: string;
  agente_id: string;
  ultima_interaccion: string;
}

/**
 * Leads con conversación "concluida" (sin actividad en la última hora) y con
 * actividad en los últimos 2 días, que todavía no fueron revisados desde su
 * última interacción.
 */
export async function getLeadsParaRevisar(agenteId: string): Promise<LeadRevisable[]> {
  const ahora = Date.now();
  const haceUnaHora = new Date(ahora - 60 * 60 * 1000).toISOString();
  const haceDosDias = new Date(ahora - 2 * 24 * 60 * 60 * 1000).toISOString();

  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, agente_id, ultima_interaccion')
    .eq('agente_id', agenteId)
    .lte('ultima_interaccion', haceUnaHora)
    .gte('ultima_interaccion', haceDosDias);
  if (error) throw new Error(`getLeadsParaRevisar: ${error.message}`);

  const candidatos = (leads ?? []) as LeadRevisable[];
  if (candidatos.length === 0) return [];

  const { data: logs, error: e2 } = await supabase
    .from('agent_review_log')
    .select('lead_id, revisado_hasta')
    .in(
      'lead_id',
      candidatos.map((l) => l.id),
    );
  if (e2) throw new Error(`getLeadsParaRevisar(log): ${e2.message}`);

  const revisadoHasta = new Map<string, string>();
  for (const r of logs ?? []) revisadoHasta.set((r as any).lead_id, (r as any).revisado_hasta);

  // solo los que tienen actividad nueva desde la última revisión
  return candidatos.filter((l) => {
    const hasta = revisadoHasta.get(l.id);
    return !hasta || new Date(l.ultima_interaccion) > new Date(hasta);
  });
}

export async function getTranscript(leadId: string): Promise<string> {
  const { data, error } = await supabase
    .from('conversaciones')
    .select('rol, contenido, created_at')
    .eq('lead_id', leadId)
    .in('rol', ['user', 'assistant'])
    .order('created_at', { ascending: true })
    .limit(60);
  if (error) throw new Error(`getTranscript: ${error.message}`);
  return (data ?? [])
    .map((m: any) => `${m.rol === 'user' ? 'Cliente' : 'Agente'}: ${m.contenido}`)
    .join('\n');
}

export async function guardarNotasRevision(agenteId: string, leadId: string, notas: NotaRevision[]): Promise<void> {
  if (notas.length === 0) return;
  const filas = notas.map((n) => ({
    agente_id: agenteId,
    lead_id: leadId,
    tipo: n.tipo,
    severidad: n.severidad,
    hallazgo: n.hallazgo,
  }));
  const { error } = await supabase.from('agent_review_notes').insert(filas);
  if (error) throw new Error(`guardarNotasRevision: ${error.message}`);
}

export async function marcarRevisado(leadId: string, hasta: string): Promise<void> {
  const { error } = await supabase
    .from('agent_review_log')
    .upsert({ lead_id: leadId, revisado_hasta: hasta }, { onConflict: 'lead_id' });
  if (error) throw new Error(`marcarRevisado: ${error.message}`);
}

/** Promueve una nota de revisión a corrección activa del prompt. */
export async function promoverNota(notaId: string): Promise<string> {
  const { data: nota, error } = await supabase
    .from('agent_review_notes')
    .select('*')
    .eq('id', notaId)
    .single();
  if (error) throw new Error(`promoverNota(select): ${error.message}`);

  const { error: e2 } = await supabase
    .from('agent_notes')
    .insert({ agente_id: (nota as any).agente_id, contenido: (nota as any).hallazgo, origen: 'revision' });
  if (e2) throw new Error(`promoverNota(insert): ${e2.message}`);

  await supabase.from('agent_review_notes').update({ estado: 'aplicada' }).eq('id', notaId);
  return (nota as any).hallazgo as string;
}
