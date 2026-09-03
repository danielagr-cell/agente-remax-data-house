// Almacén simple en memoria de mensajes (id -> contenido).
//
// ¿Para qué? WhatsApp cifra de punta a punta. Cuando el teléfono del cliente NO
// puede descifrar un mensaje que mandó el bot (sesión de Signal recién creada,
// dispositivo nuevo, etc.), muestra "Esperando el mensaje. Esto puede tomar
// tiempo" y le pide al bot que se lo REENVÍE (retry receipt). Para reenviarlo,
// Baileys necesita recuperar el contenido original vía getMessage(key). Si no lo
// tiene, el mensaje queda colgado en "Esperando…" para siempre.
//
// Acá guardamos cada mensaje que enviamos (y recibimos) por su id, con un tope
// para no crecer sin límite.
const store = new Map<string, any>();
const MAX = 3000;

export function recordarMsg(id: string | undefined | null, message: any): void {
  if (!id || !message) return;
  store.set(id, message);
  if (store.size > MAX) {
    const it = store.keys();
    for (let i = 0; i < 500; i++) {
      const n = it.next();
      if (n.done) break;
      store.delete(n.value);
    }
  }
}

export function obtenerMsg(id: string | undefined | null): any {
  if (!id) return undefined;
  return store.get(id);
}
