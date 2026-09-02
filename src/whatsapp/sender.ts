// Divide la respuesta del modelo en burbujas y las envía con "escribiendo…" y
// un pequeño delay para que se sienta una conversación humana.

export function splitMessage(texto: string, token: string): string[] {
  return texto
    .split(token)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface SenderOpts {
  token: string;
  minMs: number;
  maxMs: number;
  onSent?: (messageId: string) => void; // para deduplicar los ecos del propio bot
}

export async function enviarBurbujas(sock: any, jid: string, texto: string, opts: SenderOpts): Promise<void> {
  const burbujas = splitMessage(texto, opts.token);
  for (const b of burbujas) {
    try {
      await sock.sendPresenceUpdate('composing', jid);
    } catch {
      /* presence es best-effort */
    }
    const delay = Math.min(opts.maxMs, Math.max(opts.minMs, b.length * 45));
    await sleep(delay);
    const res = await sock.sendMessage(jid, { text: b });
    const id: string | undefined = res?.key?.id;
    if (id) opts.onSent?.(id);
  }
  try {
    await sock.sendPresenceUpdate('paused', jid);
  } catch {
    /* best-effort */
  }
}
