import { supabase } from '../db/supabase';
import type { Agente, Lead, Slot } from '../types';
import type { AgendarInput } from '../agent/tools';

const TZ = 'America/Argentina/Buenos_Aires';

export function etiquetaSlot(iso: string): string {
  const d = new Date(iso);
  const dia = new Intl.DateTimeFormat('es-AR', { weekday: 'long', timeZone: TZ }).format(d);
  const fecha = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', timeZone: TZ }).format(d);
  const hora = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(d);
  return `${dia} ${fecha} a las ${hora}`;
}

export async function consultarDisponibilidad(agente: Agente, desde?: string, hasta?: string): Promise<Slot[]> {
  const desdeIso = (desde ? new Date(desde) : new Date()).toISOString();
  let q = supabase
    .from('disponibilidad')
    .select('*')
    .eq('agente_id', agente.id)
    .eq('disponible', true)
    .gte('inicio', desdeIso);
  if (hasta) q = q.lte('inicio', new Date(hasta).toISOString());

  const { data, error } = await q.order('inicio', { ascending: true }).limit(6);
  if (error) throw new Error(`consultarDisponibilidad: ${error.message}`);
  return (data ?? []).map((row: any) => ({
    id: row.id,
    inicio: row.inicio,
    fin: row.fin,
    etiqueta: etiquetaSlot(row.inicio),
  }));
}

export async function agendarVisita(
  agente: Agente,
  lead: Lead,
  input: AgendarInput,
): Promise<{ ok: boolean; etiqueta: string }> {
  const { error } = await supabase.from('visitas').insert({
    agente_id: agente.id,
    lead_id: lead.id,
    propiedad_id: input.propiedad_id ?? null,
    slot_id: input.slot_id ?? null,
    fecha_hora: input.fecha_hora,
    nombre_cliente: input.nombre_cliente ?? lead.nombre ?? null,
    notas: input.notas ?? null,
  });
  if (error) throw new Error(`agendarVisita: ${error.message}`);

  if (input.slot_id) {
    await supabase.from('disponibilidad').update({ disponible: false }).eq('id', input.slot_id);
  }
  return { ok: true, etiqueta: etiquetaSlot(input.fecha_hora) };
}
