import { supabase } from '../db/supabase';
import type { Agente, Lead } from '../types';
import type { AlertaInput } from '../agent/tools';

/**
 * Avisa a la agente humana y actualiza el CRM. `enviarWhatsApp` lo inyecta el
 * wiring principal (usa el socket de Baileys de esa agente).
 */
export async function alertarAgenteHumano(
  agente: Agente,
  lead: Lead,
  input: AlertaInput,
  enviarWhatsApp?: (numeroE164: string, texto: string) => Promise<void>,
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (input.temperatura) update.temperatura = input.temperatura;
  if (input.pausar_bot) update.bot_pausado = true;
  if (Object.keys(update).length > 0) {
    await supabase.from('leads').update(update).eq('id', lead.id);
  }

  if (enviarWhatsApp && agente.telefono_alertas) {
    const nombre = lead.nombre ?? 'Cliente sin nombre';
    const texto =
      `🔔 *${input.tipo.toUpperCase()}* — ${agente.oficina}\n` +
      `Lead: ${nombre} (+${lead.telefono})\n` +
      `Temperatura: ${input.temperatura ?? lead.temperatura}\n` +
      `Resumen: ${input.resumen}` +
      (input.pausar_bot ? '\n\n⏸️ El bot se pausó para esta conversación. Tomá vos el chat.' : '');
    await enviarWhatsApp(agente.telefono_alertas, texto);
  }
}
