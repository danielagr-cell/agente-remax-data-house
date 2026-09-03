import { iniciarAgente } from '../whatsapp/connection';
import { enviarBurbujas } from '../whatsapp/sender';
import { procesarMensaje } from '../whatsapp/media';
import { config } from '../config';
import { logger } from '../logger';
import { recordarMsg } from '../whatsapp/msgStore';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { Agente } from '../types';
import type { Transport, MensajeEntrante } from './index';

function soloDigitos(s: any): string {
  return String(s ?? '').split('@')[0]?.split(':')[0]?.replace(/[^0-9]/g, '') ?? '';
}
function jidANumero(jid: string): string {
  return soloDigitos(jid);
}
function esGrupoOEstado(jid: string): boolean {
  return !jid || jid.endsWith('@g.us') || jid === 'status@broadcast';
}
function esLid(jid: string): boolean {
  return String(jid ?? '').endsWith('@lid');
}

/**
 * Mapa LID -> teléfono real (PN). WhatsApp está migrando a los JID "@lid" (un
 * ID interno que NO es el teléfono). Si le contestamos al "@lid", el mensaje se
 * cifra contra una identidad que el celular del cliente no espera y NUNCA le
 * llega (el "relojito eterno"). La solución es responder al JID de teléfono
 * (@s.whatsapp.net). Acá aprendemos el mapeo LID->PN apenas WhatsApp nos muestra
 * el PN, lo sembramos desde lid-map.json y lo persistimos para sobrevivir
 * reinicios.
 */
const LID_MAP_FILE = 'lid-map.json';
const lidAPn = new Map<string, string>();

function cargarLidMap(): void {
  try {
    if (!existsSync(LID_MAP_FILE)) return;
    const obj = JSON.parse(readFileSync(LID_MAP_FILE, 'utf8')) as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const lid = soloDigitos(k);
      const pn = soloDigitos(v);
      if (lid && pn) lidAPn.set(lid, pn);
    }
    logger.info(`lid-map.json cargado: ${lidAPn.size} mapeo(s) LID->teléfono.`);
  } catch (e) {
    logger.warn(`No pude leer ${LID_MAP_FILE}: ${(e as Error).message}`);
  }
}
function guardarLidMap(): void {
  try {
    const obj: Record<string, string> = {};
    for (const [k, v] of lidAPn) obj[k] = v;
    writeFileSync(LID_MAP_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch {
    /* best-effort */
  }
}
function recordarLidPn(lid: string, pn: string): void {
  const l = soloDigitos(lid);
  const p = soloDigitos(pn);
  if (!l || !p || l === p) return;
  if (lidAPn.get(l) === p) return;
  lidAPn.set(l, p);
  guardarLidMap();
  logger.info(`Mapeo LID aprendido: ${l} -> ${p}`);
}

cargarLidMap();

/**
 * Extrae el PN del mensaje si WhatsApp lo incluyó (campos reales de Baileys
 * 6.7.x: senderPn / participantPn) y de paso aprende el mapeo LID->PN.
 */
function aprenderDeMensaje(m: any): string {
  const k = m?.key ?? {};
  const pn = soloDigitos(k.senderPn || k.participantPn || '');
  const lid = soloDigitos(esLid(k.remoteJid) ? k.remoteJid : k.senderLid || k.participantLid || '');
  if (lid && pn) recordarLidPn(lid, pn);
  return pn;
}

/** Teléfono real del cliente para la base (lead): PN si lo sabemos, si no el lid. */
function telefonoDeMensaje(m: any): string {
  const jid: string = m?.key?.remoteJid ?? '';
  const pnDirecto = aprenderDeMensaje(m);
  if (pnDirecto) return pnDirecto;
  if (esLid(jid)) {
    const pn = lidAPn.get(soloDigitos(jid));
    if (pn) return pn;
  }
  return jidANumero(jid);
}

/**
 * JID de DESTINO para responder de forma que ENTREGUE: si el chat es un @lid y
 * sabemos el teléfono, contestamos al @s.whatsapp.net; si no, al @lid (última
 * opción, para no quedarnos mudos ante un lead que todavía no mapeamos).
 */
function destinoParaEnviar(jid: string): string {
  if (esLid(jid)) {
    const pn = lidAPn.get(soloDigitos(jid));
    if (pn) return `${pn}@s.whatsapp.net`;
  }
  return jid;
}

export function crearBaileysTransport(agente: Agente): Transport {
  let sock: any = null;
  const _safe = agente.nombre.replace(/[^a-z0-9]/gi, '_');
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

  const logTx = (linea: string): void => {
    try {
      writeFileSync(`tx-${_safe}.txt`, `${new Date().toISOString()} ${linea}\n`, { flag: 'a' });
    } catch {
      /* best-effort */
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
            telefono: telefonoDeMensaje(m),
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
          await onMensaje({ jid, telefono: telefonoDeMensaje(m), esEcoHumano: true, texto: '', tipoMedia: 'texto', messageId: id });
        },
      });
    },

    async enviar(jid: string, texto: string) {
      const destino = destinoParaEnviar(jid);
      if (destino !== jid) logger.info(`Respondo a ${jid} vía teléfono real ${destino}.`);
      try {
        await enviarBurbujas(sock, destino, texto, {
          token: config.bot.splitToken,
          minMs: config.bot.typingMinMs,
          maxMs: config.bot.typingMaxMs,
          onSent: (id) => {
            recordar(id);
            logTx(`SENT jid=${jid} destino=${destino} id=${id}`);
          },
        });
      } catch (e) {
        logTx(`ERROR jid=${jid} destino=${destino} err=${(e as Error).message}`);
        throw e;
      }
    },

    async enviarA(numeroE164: string, texto: string) {
      const res = await sock.sendMessage(`${soloDigitos(numeroE164)}@s.whatsapp.net`, { text: texto });
      recordar(res?.key?.id);
      recordarMsg(res?.key?.id, res?.message); // anti "Esperando el mensaje" en las alertas
    },

    dentroDeVentana() {
      return true; // Baileys no tiene ventana de 24 h
    },
  };
}
