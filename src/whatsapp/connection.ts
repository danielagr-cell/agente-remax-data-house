import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { logger } from '../logger';
import { recordarMsg, obtenerMsg } from './msgStore';
import type { Agente } from '../types';

export type MensajeHandler = (sock: any, m: any) => Promise<void>;

export interface Handlers {
  onCliente: MensajeHandler; // mensaje entrante del cliente
  onEcoHumano: MensajeHandler; // fromMe: eco del bot o respuesta manual de la agente
}

const _codePedido = new Set<string>(); // pide el codigo de vinculacion una vez por socket
const _reintento = new Map<string, number>(); // backoff: numero de intento por agente
const _reconectando = new Set<string>(); // evita reconexiones solapadas (anti-tormenta de sockets)

export async function iniciarAgente(agente: Agente, handlers: Handlers): Promise<any> {
  const authDir = join('auth', agente.id);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const _safe = agente.nombre.replace(/[^a-z0-9]/gi, '_');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    // Clave para el cartel "Esperando el mensaje": si el receptor no pudo
    // desencriptar, pide un reenvio (retry) y Baileys necesita recuperar el
    // contenido original para re-cifrarlo. Sin esto queda colgado para siempre.
    getMessage: async (key: any) => obtenerMsg(key?.id),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update: any) => {
    const { connection, lastDisconnect, qr } = update;
    if (connection) { try { writeFileSync(`conn-state-${_safe}.txt`, `${connection} @${new Date().toISOString()}`, 'utf8'); } catch { /* */ } }
    if (qr) {
      logger.info(`Escanea este QR para conectar la linea de ${agente.nombre} (WhatsApp > Dispositivos vinculados):`);
      qrcode.generate(qr, { small: true });
      try { writeFileSync(`qr-${_safe}.txt`, qr, 'utf8'); } catch { /* */ }
      try {
        const _numFile = `pair-${_safe}.txt`;
        if (existsSync(_numFile) && !_codePedido.has(agente.id) && !state.creds.registered) {
          _codePedido.add(agente.id);
          const _phone = readFileSync(_numFile, 'utf8').replace(/[^0-9]/g, '');
          if (_phone) {
            sock.requestPairingCode(_phone)
              .then((code: string) => { logger.info(`Codigo de vinculacion de ${agente.nombre}: ${code}`); writeFileSync(`code-${_safe}.txt`, code, 'utf8'); })
              .catch((e: any) => { logger.error(e); try { writeFileSync(`code-error-${_safe}.txt`, String(e?.message ?? e), 'utf8'); } catch { /* */ } });
          }
        }
      } catch { /* */ }
    }
    if (connection === 'close') {
      _codePedido.delete(agente.id);
      const status = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const reconectar = status !== DisconnectReason.loggedOut;
      try { writeFileSync(`conn-${_safe}.txt`, `status=${status} reconectar=${reconectar} @` + new Date().toISOString(), 'utf8'); } catch { /* */ }
      logger.warn(`Conexion cerrada (${agente.nombre}). status=${status}. reconectar=${reconectar}`);
      // El socket ya esta muerto: le sacamos los listeners para que no dispare
      // 'close' de nuevo y agende reconexiones fantasma (causa de la tormenta 428).
      try { sock.ev.removeAllListeners('connection.update'); } catch { /* */ }
      if (reconectar) {
        // Un solo reintento en vuelo por agente + backoff creciente: evita el loop
        // de reconexiones que WhatsApp corta con 428/503.
        if (!_reconectando.has(agente.id)) {
          _reconectando.add(agente.id);
          const intento = (_reintento.get(agente.id) ?? 0) + 1;
          _reintento.set(agente.id, intento);
          const espera = Math.min(60000, 5000 * 2 ** (intento - 1)); // 5s, 10s, 20s, 40s, 60s...
          logger.warn(`Reconexion ${agente.nombre}: intento ${intento} en ${Math.round(espera / 1000)}s.`);
          setTimeout(() => {
            _reconectando.delete(agente.id);
            iniciarAgente(agente, handlers).catch((e) => logger.error(e));
          }, espera);
        }
      } else {
        logger.error(`Sesion cerrada para ${agente.nombre}. Borra auth/${agente.id}/ y reinicia para re-vincular.`);
      }
    } else if (connection === 'open') {
      _reintento.set(agente.id, 0); // conexion estable: resetea el backoff
      _reconectando.delete(agente.id);
      logger.info(`${agente.nombre} conectada a WhatsApp.`);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }: any) => {
    try { writeFileSync(`rx-${_safe}.txt`, `${new Date().toISOString()} upsert type=${type} n=${messages?.length}\n`, { flag: 'a' }); } catch { /* */ }
    if (type !== 'notify') return;
    for (const m of messages) {
      if (!m.message) continue;
      recordarMsg(m.key?.id, m.message); // para poder reenviar ante un retry (anti "Esperando el mensaje")
      try { writeFileSync(`rx-${_safe}.txt`, `  msg fromMe=${m.key?.fromMe} jid=${m.key?.remoteJid} alt=${m.key?.remoteJidAlt ?? ''} text=${JSON.stringify(m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? Object.keys(m.message ?? {}))}\n`, { flag: 'a' }); } catch { /* */ }
      try {
        if (m.key?.fromMe) await handlers.onEcoHumano(sock, m);
        else await handlers.onCliente(sock, m);
      } catch (e) {
        logger.error(e);
      }
    }
  });

  return sock;
}
