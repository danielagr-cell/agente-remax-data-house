import { supabase } from '../db/supabase';
import type { Lead } from '../types';
import type { PerfilPatch } from '../agent/tools';

function mapLead(row: any): Lead {
  return {
    id: row.id,
    agente_id: row.agente_id,
    telefono: row.telefono,
    nombre: row.nombre,
    operacion: row.operacion,
    tipo_buscado: row.tipo_buscado,
    zonas_interes: row.zonas_interes ?? [],
    presupuesto_max: row.presupuesto_max,
    moneda: row.moneda,
    motivo: row.motivo,
    urgencia: row.urgencia,
    temperatura: row.temperatura ?? 'frio',
    estado_funnel: row.estado_funnel ?? 'nuevo',
    origen: row.origen,
    notas: row.notas,
    bot_pausado: row.bot_pausado ?? false,
  };
}

export async function getOrCreateLead(agenteId: string, telefono: string, origen?: string): Promise<Lead> {
  const { data: existente, error: e1 } = await supabase
    .from('leads')
    .select('*')
    .eq('agente_id', agenteId)
    .eq('telefono', telefono)
    .maybeSingle();
  if (e1) throw new Error(`getOrCreateLead(select): ${e1.message}`);
  if (existente) return mapLead(existente);

  const { data: creado, error: e2 } = await supabase
    .from('leads')
    .insert({ agente_id: agenteId, telefono, origen: origen ?? null })
    .select('*')
    .single();
  if (e2) throw new Error(`getOrCreateLead(insert): ${e2.message}`);
  return mapLead(creado);
}

export async function guardarPerfilLead(lead: Lead, patch: PerfilPatch): Promise<void> {
  const update: Record<string, unknown> = { ultima_interaccion: new Date().toISOString() };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== null) update[k] = v;
  }
  const { error } = await supabase.from('leads').update(update).eq('id', lead.id);
  if (error) throw new Error(`guardarPerfilLead: ${error.message}`);
}

export async function setPausado(leadId: string, valor: boolean): Promise<void> {
  const { error } = await supabase.from('leads').update({ bot_pausado: valor }).eq('id', leadId);
  if (error) throw new Error(`setPausado: ${error.message}`);
}
