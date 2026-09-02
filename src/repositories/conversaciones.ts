import { supabase } from '../db/supabase';

export interface TurnoHistorial {
  role: 'user' | 'assistant';
  content: string;
}

/** Trae los últimos N turnos (user/assistant) en orden cronológico para el contexto del LLM. */
export async function getHistorial(leadId: string, limit = 20): Promise<TurnoHistorial[]> {
  const { data, error } = await supabase
    .from('conversaciones')
    .select('rol, contenido, created_at')
    .eq('lead_id', leadId)
    .in('rol', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getHistorial: ${error.message}`);
  const filas = (data ?? []).reverse();
  return filas
    .filter((f: any) => typeof f.contenido === 'string' && f.contenido.length > 0)
    .map((f: any) => ({ role: f.rol as 'user' | 'assistant', content: f.contenido as string }));
}

export async function guardarMensaje(
  leadId: string,
  agenteId: string,
  rol: 'user' | 'assistant' | 'tool',
  contenido: string,
  tipoMedia: 'texto' | 'audio' | 'imagen' | 'video' = 'texto',
  meta?: unknown,
): Promise<void> {
  const { error } = await supabase.from('conversaciones').insert({
    lead_id: leadId,
    agente_id: agenteId,
    rol,
    contenido,
    tipo_media: tipoMedia,
    meta: meta ?? null,
  });
  if (error) throw new Error(`guardarMensaje: ${error.message}`);
}
