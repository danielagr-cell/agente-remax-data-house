import type { Agente } from '../types';
import { config } from '../config';
import { crearBaileysTransport } from './baileys';

// Formato interno único: todo mensaje entrante se normaliza a esto (lección del CRM).
export interface MensajeEntrante {
  jid: string;
  telefono: string; // E.164 sin +
  texto: string;
  tipoMedia: 'texto' | 'audio' | 'imagen' | 'video';
  imagenBase64?: string;
  mimetype?: string;
  esEcoHumano: boolean; // true = la agente respondió manualmente desde su celular
  messageId?: string;
}

/**
 * Interfaz de transporte: el resto del sistema NO sabe qué proveedor está activo.
 * Cambiar de Baileys a Cloud API toca solo el adaptador.
 */
export interface Transport {
  nombre: string;
  iniciar(onMensaje: (msg: MensajeEntrante) => Promise<void>): Promise<void>;
  enviar(jid: string, texto: string): Promise<void>; // texto libre (dentro de la ventana)
  enviarA(numeroE164: string, texto: string): Promise<void>; // alertas a la agente
  // Ventana de 24 h: Baileys => siempre true; Cloud API => se calcula por la última respuesta del cliente.
  dentroDeVentana(jid: string): boolean;
}

export function crearTransport(agente: Agente): Transport {
  switch (config.whatsappTransport) {
    case 'baileys':
      return crearBaileysTransport(agente);
    case 'cloud':
      throw new Error(
        'Transporte Cloud API pendiente (Fase 2): implementá transport/cloud.ts con esta misma interfaz. ' +
          'Ahí vive la ventana de 24 h y las plantillas aprobadas.',
      );
    default:
      throw new Error(`Transporte desconocido: ${config.whatsappTransport}`);
  }
}
