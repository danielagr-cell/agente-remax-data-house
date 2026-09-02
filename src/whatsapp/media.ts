import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { config } from '../config';
import { logger } from '../logger';

export interface EntradaProcesada {
  texto: string; // lo que ve el LLM (texto, transcripción, caption o marcador)
  tipoMedia: 'texto' | 'audio' | 'imagen' | 'video';
  imagenBase64?: string; // si hay imagen, para visión
  mimetype?: string;
}

export async function procesarMensaje(sock: any, m: any): Promise<EntradaProcesada> {
  const msg = m.message ?? {};

  if (msg.conversation) return { texto: msg.conversation, tipoMedia: 'texto' };
  if (msg.extendedTextMessage?.text) return { texto: msg.extendedTextMessage.text, tipoMedia: 'texto' };

  if (msg.imageMessage) {
    const buffer = (await descargar(sock, m)) as Buffer;
    const caption: string = msg.imageMessage.caption ?? '';
    return {
      texto: caption || '[Imagen recibida]',
      tipoMedia: 'imagen',
      imagenBase64: buffer.toString('base64'),
      mimetype: msg.imageMessage.mimetype ?? 'image/jpeg',
    };
  }

  if (msg.audioMessage) {
    const buffer = (await descargar(sock, m)) as Buffer;
    const transcripcion = await transcribirAudio(buffer, msg.audioMessage.mimetype ?? 'audio/ogg');
    return {
      texto: transcripcion
        ? `[Audio transcripto]: ${transcripcion}`
        : '[Audio recibido - transcripción no configurada]',
      tipoMedia: 'audio',
    };
  }

  if (msg.videoMessage) return { texto: '[Video recibido]', tipoMedia: 'video' };
  if (msg.documentMessage) {
    return { texto: `[Documento recibido: ${msg.documentMessage.fileName ?? 'archivo'}]`, tipoMedia: 'texto' };
  }
  return { texto: '[Mensaje no soportado]', tipoMedia: 'texto' };
}

async function descargar(sock: any, m: any): Promise<Buffer> {
  return (await downloadMediaMessage(m as any, 'buffer', {}, {
    logger: logger as any,
    reuploadRequest: sock.updateMediaMessage,
  })) as Buffer;
}

/**
 * Transcripción de audios. Stub listo para enchufar Groq/OpenAI Whisper.
 * Con TRANSCRIPCION_PROVIDER=none devuelve '' y el bot responde igual pidiendo texto.
 */
async function transcribirAudio(buffer: Buffer, mimetype: string): Promise<string> {
  const prov = config.transcripcion.provider;
  const key = config.transcripcion.apiKey;
  if (prov === 'none' || !key) return '';
  const base = prov === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1';
  const model = prov === 'groq' ? 'whisper-large-v3' : 'whisper-1';
  const ext = mimetype.includes('mp4') || mimetype.includes('m4a') ? 'm4a' : mimetype.includes('mpeg') ? 'mp3' : 'ogg';
  try {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimetype }), `audio.${ext}`);
    form.append('model', model);
    form.append('language', 'es');
    const r = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!r.ok) {
      logger.error(`Transcripción ${prov} HTTP ${r.status}: ${await r.text().catch(() => '')}`);
      return '';
    }
    const data = (await r.json()) as { text?: string };
    return (data.text ?? '').trim();
  } catch (e) {
    logger.error(`Transcripción (${prov}): ${(e as Error).message}`);
    return '';
  }
}
