import { supabase } from '../db/supabase';
import type { Agente } from '../types';

function mapAgente(row: any): Agente {
  return {
    id: row.id,
    nombre: row.nombre,
    apellido: row.apellido,
    oficina: row.oficina ?? 'RE/MAX Data House',
    matricula: row.matricula,
    codigo_referido: row.codigo_referido,
    whatsapp_numero: row.whatsapp_numero,
    telefono_alertas: row.telefono_alertas,
    zonas_cobertura: row.zonas_cobertura ?? [],
    horario_atencion: row.horario_atencion ?? 'Lun a Sáb, 9 a 19 h',
    tono: row.tono ?? null,
    business_info: row.business_info ?? {},
    activo: row.activo ?? true,
  };
}

export async function getAgentesActivos(): Promise<Agente[]> {
  const { data, error } = await supabase.from('agentes').select('*').eq('activo', true);
  if (error) throw new Error(`getAgentesActivos: ${error.message}`);
  return (data ?? []).map(mapAgente);
}

export async function getAgentePorNumero(whatsappNumero: string): Promise<Agente | null> {
  const { data, error } = await supabase.from('agentes').select('*').eq('whatsapp_numero', whatsappNumero).maybeSingle();
  if (error) throw new Error(`getAgentePorNumero: ${error.message}`);
  return data ? mapAgente(data) : null;
}
