import { supabase } from '../db/supabase';

/** Correcciones vigentes que se inyectan en el prompt de cada conversación. */
export async function getNotasActivas(agenteId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('agent_notes')
    .select('contenido')
    .eq('agente_id', agenteId)
    .eq('activa', true)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getNotasActivas: ${error.message}`);
  return (data ?? []).map((r: any) => r.contenido as string);
}

export async function crearNota(agenteId: string, contenido: string, origen = 'manual'): Promise<void> {
  const { error } = await supabase.from('agent_notes').insert({ agente_id: agenteId, contenido, origen });
  if (error) throw new Error(`crearNota: ${error.message}`);
}
