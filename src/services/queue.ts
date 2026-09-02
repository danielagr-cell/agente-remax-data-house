// Cola por número: agrupa mensajes rápidos (debounce) y serializa el procesamiento
// por cada JID, para que el bot responda una vez y en orden (feel humano).

export interface PendienteMsg {
  texto: string;
  tipoMedia: 'texto' | 'audio' | 'imagen' | 'video';
  imagenBase64?: string;
  mimetype?: string;
}

type Handler = (jid: string, mensajes: PendienteMsg[]) => Promise<void>;

export class ColaPorNumero {
  private buffers = new Map<string, PendienteMsg[]>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private cadenas = new Map<string, Promise<void>>();

  constructor(
    private readonly debounceMs: number,
    private readonly handler: Handler,
  ) {}

  push(jid: string, msg: PendienteMsg): void {
    const buf = this.buffers.get(jid) ?? [];
    buf.push(msg);
    this.buffers.set(jid, buf);

    const prev = this.timers.get(jid);
    if (prev) clearTimeout(prev);
    this.timers.set(
      jid,
      setTimeout(() => this.flush(jid), this.debounceMs),
    );
  }

  private flush(jid: string): void {
    const msgs = this.buffers.get(jid) ?? [];
    this.buffers.delete(jid);
    this.timers.delete(jid);
    if (msgs.length === 0) return;

    const anterior = this.cadenas.get(jid) ?? Promise.resolve();
    const corrida = anterior.then(() => this.handler(jid, msgs)).catch((e) => console.error('[cola]', e));
    this.cadenas.set(jid, corrida);
  }
}
