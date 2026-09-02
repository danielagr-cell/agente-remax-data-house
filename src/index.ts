import { config, validarConfig } from './config';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { iniciarWeb } from './web/server';
import { logger } from './logger';
import type { Agente } from './types';
import { getAgentesActivos } from './repositories/agentes';
import { getOrCreateLead, setPausado } from './repositories/leads';
import { getHistorial, guardarMensaje } from './repositories/conversaciones';
import { getNotasActivas } from './repositories/notas';
import { crearRepos } from './repositories';
import { crearTransport, type Transport, type MensajeEntrante } from './transport';
import { ColaPorNumero, type PendienteMsg } from './services/queue';
import { runAgentTurn } from './agent/brain';
import { evaluarLead } from './scoring/scorer';
import { cargarTemplate, componerSystemPrompt } from './agent/prompt';
import type { Repos } from './agent/tools';

const template = cargarTemplate();
const vistos = new Set<string>(); // dedup de mensajes entrantes (anti-duplicados)
const telefonoPorJid = new Map<string, string>(); // jid -> teléfono real (resuelve el @lid de WhatsApp)

function fechaHoraAhora(): string {
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date());
}

function jidANumero(jid: string): string {
  return (jid.split('@')[0] ?? '').split(':')[0] ?? '';
}

async function manejarTurno(
  agente: Agente,
  transport: Transport,
  repos: Repos,
  jid: string,
  mensajes: PendienteMsg[],
): Promise<void> {
  // El teléfono real lo resolvió el transporte (maneja el @lid); si no está, caemos al jid.
  const telefono = telefonoPorJid.get(jid) ?? jidANumero(jid);
  const lead = await getOrCreateLead(agente.id, telefono);
  try { writeFileSync('turn-log.txt', `${new Date().toISOString()} ENTER tel=${telefono} lead=${lead.id} pausado=${lead.bot_pausado}\n`, { flag: 'a' }); } catch { /* */ }

  const _bypassPausa = (() => { try { return existsSync('test-bypass.txt') && readFileSync('test-bypass.txt', 'utf8').includes(telefono); } catch { return false; } })();
  if (lead.bot_pausado && !_bypassPausa) {
    logger.info(`Lead +${telefono} pausado (intervención humana). El bot no responde.`);
    return;
  }

  const historial = await getHistorial(lead.id, 20);
  const esNueva = historial.length === 0;

  const textoUnificado = mensajes
    .map((x) => x.texto)
    .filter((t) => t && t.length > 0)
    .join('\n');
  const imagenes = mensajes.filter((x) => x.imagenBase64);

  let userContent: any;
  if (imagenes.length > 0) {
    userContent = [
      ...imagenes.map((im) => ({
        type: 'image',
        image: im.imagenBase64,
        mediaType: im.mimetype ?? 'image/jpeg',
      })),
      { type: 'text', text: textoUnificado || '(el cliente mandó una imagen)' },
    ];
  } else {
    userContent = textoUnificado || '(mensaje vacío)';
  }

  const notas = await getNotasActivas(agente.id);
  const systemPrompt = componerSystemPrompt(template, agente, lead, {
    fechaHora: fechaHoraAhora(),
    esNueva,
    businessInfo: agente.business_info,
    notasActivas: notas,
  });

  const { text, toolsUsed, modelo } = await runAgentTurn(
    {
      systemPrompt,
      repos,
      agente,
      lead,
      onTool: (name) => logger.info(`🔧 [${agente.nombre}] tool: ${name}`),
    },
    historial,
    userContent,
  );

  try { writeFileSync('turn-log.txt', `${new Date().toISOString()} tel=${telefono} textlen=${(text ?? '').length} modelo=${modelo ?? '-'} tools=${JSON.stringify(toolsUsed ?? [])}\n`, { flag: 'a' }); } catch { /* */ }

  for (const x of mensajes) {
    await guardarMensaje(lead.id, agente.id, 'user', x.texto, x.tipoMedia);
  }
  await guardarMensaje(lead.id, agente.id, 'assistant', text, 'texto', { toolsUsed, modelo });

  if (text) await transport.enviar(jid, text);

  // Scorer de fondo: puntúa el lead y, si recién ahora se vuelve caliente, alerta a la agente.
  // Fire-and-forget: no bloquea ni rompe la respuesta al cliente.
  void evaluarLead({ agente, repos }, lead).catch((e) => logger.error(`scorer +${telefono}: ${(e as Error).message}`));
}

async function main(): Promise<void> {
  validarConfig();

  let agentes = await getAgentesActivos();
  if (existsSync('solo-daniela.flag')) { agentes = agentes.filter((a) => a.nombre.toLowerCase() === 'daniela'); logger.info('[solo-daniela.flag] corriendo unicamente la linea Daniela'); }
  if (agentes.length === 0) {
    logger.error('No hay agentes activas. Corré supabase/seed.sql o cargá una agente en la tabla "agentes".');
    process.exit(1);
  }
  logger.info(`Iniciando ${agentes.length} línea(s): ${agentes.map((a) => a.nombre).join(', ')}`);

  for (const agente of agentes) {
    const transport = crearTransport(agente);
    const repos = crearRepos({ enviarWhatsApp: (numero, texto) => transport.enviarA(numero, texto) });

    const cola = new ColaPorNumero(config.bot.debounceMs, (jid, mensajes) =>
      manejarTurno(agente, transport, repos, jid, mensajes).catch((e) => { logger.error(e); try { writeFileSync('turn-error.txt', new Date().toISOString() + ' ' + String((e as any)?.stack ?? (e as any)?.message ?? e) + '\n', { flag: 'a' }); } catch { /* */ } }),
    );

    await transport.iniciar(async (msg: MensajeEntrante) => {
      // La agente respondió manualmente desde su celular → pausar el bot para ese lead.
      if (msg.esEcoHumano) {
        const lead = await getOrCreateLead(agente.id, msg.telefono);
        if (!lead.bot_pausado) {
          await setPausado(lead.id, true);
          logger.info(`✋ ${agente.nombre} tomó el chat de +${msg.telefono}. Bot pausado para ese lead.`);
        }
        return;
      }

      // Guardamos el teléfono real resuelto por el transporte, atado a este jid,
      // así manejarTurno lo usa aunque el jid sea un @lid.
      if (msg.telefono) telefonoPorJid.set(msg.jid, msg.telefono);

      if (msg.messageId) {
        if (vistos.has(msg.messageId)) return;
        vistos.add(msg.messageId);
      }
      cola.push(msg.jid, {
        texto: msg.texto,
        tipoMedia: msg.tipoMedia,
        imagenBase64: msg.imagenBase64,
        mimetype: msg.mimetype,
      });
    });

    logger.info(`Línea lista: ${agente.nombre} (transporte: ${transport.nombre}).`);
  }

  // Panel web (solo lectura). OPCIONAL: arranca solo si existe web-panel.flag.
  if (existsSync('web-panel.flag')) {
    try { iniciarWeb(); } catch (e) { logger.error(`No se pudo iniciar el panel web: ${(e as Error).message}`); }
  }
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
