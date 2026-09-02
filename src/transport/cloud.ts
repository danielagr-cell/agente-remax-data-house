// Adaptador de WhatsApp Business Cloud API (Meta) — implementa la MISMA interfaz Transport
// que Baileys. Envía por la Graph API (REST) y recibe por webhook (POST de Meta).
//
// Estado: esqueleto funcional. El ENVÍO ya funciona con credenciales; la RECEPCIÓN
// necesita que un servidor HTTP público (a montar en el deploy) enrute los webhooks
// hacia procesarWebhookEntrante(). Cada agente usa su propio phone_number_id + token
// (en business_info.cloud, o por env como fallback para un solo número).
import type { Agente } from '../types';
import { logger } from '../logger';
import type { Transport, MensajeEntrante } from './index';

const GRAPH = process.env.WHATSAPP_GRAPH_VERSION ?? 'v20.0';

// --- Enrutador de webhooks: el servidor público llama a esto con el payload de Meta ---
type WebhookHandler = (value: any) => Promise<void>;
const handlers = new Map<string, WebhookHandler>(); // phone_number_id -> handler del agente

export function registrarWebhookHandler(phoneNumberId: string, h: WebhookHandler): void {
  if (phoneNumberId) handlers.set(phoneNumberId, h);
}

/** Enrutá acá el POST del webhook de Meta (desde el server HTTP público). */
export async function procesarWebhookEntrante(payload: any): Promise<void> {
  try {
    for (const entry of payload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const pnid = change?.value?.metadata?.phone_number_id;
        const h = pnid ? handlers.get(pnid) : undefined;
        if (h) await h(change.value);
      }
    }
  } catch (e) {
    logger.error(e);
  }
}

function credsDe(agente: Agente): { phoneNumberId: string; token: string } {
  const c = ((agente.business_info as any)?.cloud ?? {}) as { phoneNumberId?: string; token?: string };
  return {
    phoneNumberId: c.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    token: c.token || process.env.WHATSAPP_CLOUD_TOKEN || '',
  };
}

export function crearCloudTransport(agente: Agente): Transport {
  const { phoneNumberId, token } = credsDe(agente);
  const ultimoInbound = new Map<string, number>(); // numero E.164 -> ms del ultimo mensaje del cliente

  async function enviarTexto(numeroE164: string, texto: string): Promise<void> {
    if (!phoneNumberId || !token) {
      logger.error(`Cloud API sin credenciales para ${agente.nombre} (business_info.cloud o env).`);
      return;
    }
    const url = `https://graph.facebook.com/${GRAPH}/${phoneNumberId}/messages`;
    const body = { messaging_product: 'whatsapp', recipient_type: 'individual', to: numeroE164, type: 'text', text: { preview_url: false, body: texto } };
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) logger.error(`Cloud send HTTP ${r.status}: ${await r.text().catch(() => '')}`);
    } catch (e) {
      logger.error(`Cloud send (${agente.nombre}): ${(e as Error).message}`);
    }
  }

  return {
    nombre: 'cloud',

    async iniciar(onMensaje: (msg: MensajeEntrante) => Promise<void>) {
      if (!phoneNumberId) {
        logger.warn(`Cloud transport de ${agente.nombre}: falta phone_number_id. Configuralo en business_info.cloud o env.`);
      }
      registrarWebhookHandler(phoneNumberId, async (value: any) => {
        for (const m of value?.messages ?? []) {
          const from: string = m.from; // E.164 sin +
          ultimoInbound.set(from, Date.now());
          // TODO: mapear image/audio como en whatsapp/media.ts (Meta manda un media id que hay que bajar).
          const texto: string =
            m.text?.body ??
            (m.type === 'audio' ? '[Audio recibido]' : m.type === 'image' ? '[Imagen recibida]' : `[${m.type ?? 'mensaje'} recibido]`);
          try {
            await onMensaje({ jid: from, telefono: from, texto, tipoMedia: 'texto', esEcoHumano: false, messageId: m.id });
          } catch (e) {
            logger.error(e);
          }
        }
      });
    },

    async enviar(jid: string, texto: string) {
      // Dentro de las 24h => texto libre. Fuera => hace falta plantilla aprobada (TODO: enviarPlantilla).
      await enviarTexto(jid, texto);
    },

    async enviarA(numeroE164: string, texto: string) {
      await enviarTexto(numeroE164, texto);
    },

    dentroDeVentana(jid: string): boolean {
      const t = ultimoInbound.get(jid);
      return t !== undefined && Date.now() - t < 24 * 60 * 60 * 1000;
    },
  };
}
