import { iniciarAgente } from '../whatsapp/connection';
import { enviarBurbujas } from '../whatsapp/sender';
import { procesarMensaje } from '../whatsapp/media';
import { config } from '../config';
import { logger } from '../logger';
import type { Agente } from '../types';
import type { Transport, MensajeEntrante } from './index';

function jidANumero(jid: string): string {
  return (jid.split('@')[0] ?? '').split(':')[0] ?? '';
}
function esGrupoOEstado(jid: string): boolean {
  return !jid || jid.endsWith('@g.us') || jid === 'status@broadcast';
}

/**
 * Número de teléfono real del cliente. WhatsApp a veces manda un JID "@lid"
 * (un ID interno, NO es el teléfono): en ese caso el número real viene en
 * remoteJidAlt / participantAlt / senderPn según la versión de Baileys. Si no
 * está, cae al lid (sirve para rutear, pero no es un teléfono lindo). Logueamos
 * el caso @lid una línea para poder ajustar si hiciera falta.
 */
function numeroDeMensaje(m: any): string {
  const jid: string = m?.key?.remoteJid ?? '';
  if (jid.endsWith('@lid')) {
    const alt: string = m?.key?.remoteJidAlt || m?.key?.participantAlt || m?.key?.senderPn || '';
    logger.info(
      `LID entrante: remoteJid=${jid} remoteJidAlt=${m?.key?.remoteJidAlt ?? '-'} participantAlt=${m?.key?.participantAlt ?? '-'} senderPn=${m?.key?.senderPn ?? '-'}`,
    );
    if (alt) return (alt.split('@')[0] ?? '').split(':')[0] ?? '';
  }
  return jidANumero(jid);
}

export function crearBaileysTransport(agente: Agente): Transport {
  let sock: any = null;
  const enviadosPorBot = new Set<string>();

  const recordar = (id?: string | null): void => {
    if (!id) return;
    enviadosPorBot.add(id);
    if (enviadosPorBot.size > 5000) {
      const it = enviadosPorBot.values();
      for (let i = 0; i < 1000; i++) {
        const n = it.next();
        if (n.done) break;
        enviadosPorBot.delete(n.value);
      }
    }
  };

  return {
    nombre: 'baileys',

    async iniciar(onMensaje: (msg: MensajeEntrante) => Promise<void>) {
      sock = await iniciarAgente(agente, {
        onCliente: async (s, m) => {
          const jid: string = m.key?.remoteJid ?? '';
          if (esGrupoOEstado(jid)) return;
          const entrada = await procesarMensaje(s, m);
          await onMensaje({
            jid,
            telefono: numeroDeMensaje(m),
            esEcoHumano: false,
            messageId: m.key?.id,
            ...entrada,
          });
        },
        onEcoHumano: async (_s, m) => {
          const id: string | undefined = m.key?.id;
          if (id && enviadosPorBot.has(id)) return; // eco del propio bot: ignorar
          const jid: string = m.key?.remoteJid ?? '';
          if (esGrupoOEstado(jid)) return;
          // respuesta manual de la agente desde su celular → intervención humana
          await onMensaje({ jid, telefono: numeroDeMensaje(m), esEcoHumano: true, texto: '', tipoMedia: 'texto', messageId: id });
        },
      });
    },

    async enviar(jid: string, texto: string) {
      await enviarBurbujas(sock, jid, texto, {
        token: config.bot.splitToken,
        minMs: config.bot.typingMinMs,
        maxMs: config.bot.typingMaxMs,
        onSent: recordar,
      });
    },

    async enviarA(numeroE164: string, texto: string) {
      const res = await sock.sendMessage(`${numeroE164}@s.whatsapp.net`, { text: texto });
      recordar(res?.key?.id);
    },

    dentroDeVentana() {
      return true; // Baileys no tiene ventana de 24 h
    },
  };
}
