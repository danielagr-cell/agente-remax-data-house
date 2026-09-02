// Tipos de dominio compartidos.

export interface Agente {
  id: string;
  nombre: string;
  apellido?: string | null;
  oficina: string;
  matricula?: string | null;
  codigo_referido: string;
  whatsapp_numero: string;
  telefono_alertas?: string | null;
  zonas_cobertura: string[];
  horario_atencion: string;
  tono?: string | null;
  business_info: Record<string, unknown>;
  activo: boolean;
}

export interface NotaActiva {
  id: string;
  agente_id: string;
  contenido: string;
  activa: boolean;
  origen: string;
}

export interface NotaRevision {
  tipo: 'fallo' | 'mejora';
  severidad: 'baja' | 'media' | 'alta';
  hallazgo: string;
}

export interface Propiedad {
  id: string;
  codigo_remax?: string | null;
  agente_id?: string | null;
  operacion: string;
  tipo: string;
  titulo: string;
  zona: string;
  direccion?: string | null;
  precio?: number | null;
  moneda: string;
  ambientes?: number | null;
  dormitorios?: number | null;
  banos?: number | null;
  cochera?: boolean | null;
  metros_cubiertos?: number | null;
  metros_totales?: number | null;
  expensas?: number | null;
  orientacion?: string | null;
  apto_credito?: boolean | null;
  a_estrenar?: boolean | null;
  extras: string[];
  descripcion?: string | null;
  link_oficial?: string | null;
  estado: string;
}

export interface Lead {
  id: string;
  agente_id: string;
  telefono: string;
  nombre?: string | null;
  operacion?: string | null;
  tipo_buscado?: string | null;
  zonas_interes: string[];
  presupuesto_max?: number | null;
  moneda?: string | null;
  motivo?: string | null;
  urgencia?: string | null;
  temperatura: string;
  estado_funnel: string;
  origen?: string | null;
  notas?: string | null;
  bot_pausado: boolean;
}

// Un slot de agenda ya legible para el cliente.
export interface Slot {
  id: string;
  inicio: string; // ISO
  fin: string; // ISO
  etiqueta: string; // "miércoles 27/08 a las 17 h"
}

// Mensaje del historial en formato Anthropic (role + content).
export interface MensajeLLM {
  role: 'user' | 'assistant';
  content: unknown;
}
