import { tool } from 'ai';
import { z } from 'zod';
import type { Agente, Lead, Propiedad, Slot } from '../types';

// ============================================================
//  Contrato de repositorios (lo implementa Supabase o los fakes del test)
// ============================================================
export interface BuscarPropiedadesInput {
  operacion: string;
  tipo?: string;
  zonas?: string[];
  presupuesto_min?: number;
  presupuesto_max?: number;
  moneda?: string;
  ambientes?: number;
  dormitorios?: number;
  cochera?: boolean;
  extras?: string[];
}

export interface PerfilPatch {
  nombre?: string;
  operacion?: string;
  tipo_buscado?: string;
  zonas_interes?: string[];
  presupuesto_max?: number;
  moneda?: string;
  motivo?: string;
  urgencia?: string;
  temperatura?: string;
  notas?: string;
}

export interface AgendarInput {
  propiedad_id?: string;
  slot_id?: string;
  fecha_hora: string;
  nombre_cliente?: string;
  notas?: string;
}

export interface AlertaInput {
  tipo: string;
  resumen: string;
  temperatura?: string;
  pausar_bot?: boolean;
}

export interface Repos {
  buscarPropiedades(input: BuscarPropiedadesInput): Promise<Propiedad[]>;
  obtenerDetallePropiedad(propiedadId: string): Promise<Propiedad | null>;
  guardarPerfilLead(lead: Lead, patch: PerfilPatch): Promise<void>;
  consultarDisponibilidad(agente: Agente, desde?: string, hasta?: string): Promise<Slot[]>;
  agendarVisita(agente: Agente, lead: Lead, input: AgendarInput): Promise<{ ok: boolean; etiqueta: string }>;
  alertarAgenteHumano(agente: Agente, lead: Lead, input: AlertaInput): Promise<void>;
}

export interface ToolCtx {
  agente: Agente;
  lead: Lead;
  repos: Repos;
  onTool?: (name: string) => void;
}

// ============================================================
//  Utilidades de presentación
// ============================================================
export function linkConReferido(prop: Propiedad, codigoReferido?: string): string {
  const base = prop.link_oficial ?? '';
  if (!base) return '';
  if (!codigoReferido) return base; // sin referido cargado: link público pelado, no rompas
  const sep = base.includes('?') ? '&' : '?';
  // RE/MAX atribuye el contacto/comisión por el parámetro ?associate={número de associate}.
  return `${base}${sep}associate=${encodeURIComponent(codigoReferido)}`;
}

function propiedadResumen(prop: Propiedad, codigoReferido: string) {
  return {
    id: prop.id,
    codigo_remax: prop.codigo_remax ?? null,
    titulo: prop.titulo,
    zona: prop.zona,
    operacion: prop.operacion,
    precio: prop.precio ?? null,
    moneda: prop.moneda,
    ambientes: prop.ambientes ?? null,
    cochera: prop.cochera ?? null,
    apto_credito: prop.apto_credito ?? null,
    expensas: prop.expensas ?? null,
    link: linkConReferido(prop, codigoReferido),
  };
}

// ============================================================
//  Tools (formato Vercel AI SDK: description + inputSchema Zod + execute)
//  createTools cierra sobre el contexto (agente + lead + repos) de cada turno.
// ============================================================
export function createTools(ctx: ToolCtx) {
  const ref = ctx.agente.codigo_referido;

  return {
    buscar_propiedades: tool({
      description:
        'Busca propiedades en el catálogo oficial de RE/MAX que coincidan con los criterios. Devuelve una lista con su link (ya con el código de referido de la agente). Usala cuando ya tenés operación + pista de zona, tipo o presupuesto. Nunca describas propiedades que no vengan de acá.',
      inputSchema: z.object({
        operacion: z.enum(['venta', 'alquiler', 'alquiler_temporario']),
        tipo: z
          .enum(['departamento', 'casa', 'ph', 'monoambiente', 'terreno', 'local', 'oficina', 'cochera', 'galpon'])
          .optional(),
        zonas: z.array(z.string()).optional(),
        presupuesto_min: z.number().optional(),
        presupuesto_max: z.number().optional(),
        moneda: z.enum(['USD', 'ARS']).optional(),
        ambientes: z.number().int().optional(),
        dormitorios: z.number().int().optional(),
        cochera: z.boolean().optional(),
        extras: z.array(z.string()).optional(),
      }),
      execute: async (input) => {
        ctx.onTool?.('buscar_propiedades');
        const props = await ctx.repos.buscarPropiedades(input as BuscarPropiedadesInput);
        return { encontradas: props.length, propiedades: props.map((p) => propiedadResumen(p, ref)) };
      },
    }),

    obtener_detalle_propiedad: tool({
      description:
        'Trae la ficha completa de una propiedad puntual (expensas, metros, orientación, disponibilidad, link). Usala para detalles de una propiedad concreta por ID. Si un dato no viene, NO lo inventes: derivá.',
      inputSchema: z.object({ propiedad_id: z.string() }),
      execute: async ({ propiedad_id }) => {
        ctx.onTool?.('obtener_detalle_propiedad');
        const prop = await ctx.repos.obtenerDetallePropiedad(propiedad_id);
        if (!prop) return { encontrada: false };
        return { encontrada: true, propiedad: { ...prop, link: linkConReferido(prop, ref) } };
      },
    }),

    guardar_perfil_lead: tool({
      description:
        'Guarda o actualiza en el CRM los datos y preferencias del cliente (nombre, presupuesto, zona, tipo, motivo, urgencia, temperatura). Usala silenciosa cada vez que aparece info nueva.',
      inputSchema: z.object({
        nombre: z.string().optional(),
        operacion: z.enum(['venta', 'alquiler', 'alquiler_temporario']).optional(),
        tipo_buscado: z.string().optional(),
        zonas_interes: z.array(z.string()).optional(),
        presupuesto_max: z.number().optional(),
        moneda: z.enum(['USD', 'ARS']).optional(),
        motivo: z.enum(['vivienda', 'inversion', 'mudanza', 'upgrade', 'otro']).optional(),
        urgencia: z.enum(['exploratoria', 'media', 'alta']).optional(),
        temperatura: z.enum(['frio', 'tibio', 'caliente']).optional(),
        notas: z.string().optional(),
      }),
      execute: async (patch) => {
        ctx.onTool?.('guardar_perfil_lead');
        await ctx.repos.guardarPerfilLead(ctx.lead, patch as PerfilPatch);
        Object.assign(ctx.lead, patch); // reflejar en memoria del turno
        return { ok: true };
      },
    }),

    consultar_disponibilidad_agenda: tool({
      description:
        'Consulta los horarios libres de la agente para una visita. Usala cuando el cliente confirmó interés firme, ANTES de ofrecer horarios. Devuelve slots concretos con su slot_id.',
      inputSchema: z.object({
        propiedad_id: z.string().optional(),
        desde: z.string().optional(),
        hasta: z.string().optional(),
      }),
      execute: async ({ desde, hasta }) => {
        ctx.onTool?.('consultar_disponibilidad_agenda');
        const slots = await ctx.repos.consultarDisponibilidad(ctx.agente, desde, hasta);
        return { slots: slots.map((s) => ({ slot_id: s.id, etiqueta: s.etiqueta, inicio: s.inicio })) };
      },
    }),

    agendar_visita: tool({
      description:
        'Reserva una visita en la agenda y la registra en el CRM. Usala solo después de que el cliente eligió un horario concreto de los ofrecidos. Confirmá los datos después.',
      inputSchema: z.object({
        propiedad_id: z.string().optional(),
        slot_id: z.string().optional(),
        fecha_hora: z.string(),
        nombre_cliente: z.string().optional(),
        notas: z.string().optional(),
      }),
      execute: async (input) => {
        ctx.onTool?.('agendar_visita');
        return ctx.repos.agendarVisita(ctx.agente, ctx.lead, input as AgendarInput);
      },
    }),

    alertar_agente_humano: tool({
      description:
        'Avisa al celular de la agente humana y, si corresponde, pausa el bot. Usala para lead CALIENTE, pedido de hablar con una persona, queja, o algo fuera de tu alcance. Silenciosa: no le anuncies al cliente.',
      inputSchema: z.object({
        tipo: z.enum(['lead_caliente', 'pide_humano', 'queja', 'fuera_de_scope', 'consulta_sin_dato']),
        resumen: z.string(),
        temperatura: z.enum(['frio', 'tibio', 'caliente']).optional(),
        pausar_bot: z.boolean().optional(),
      }),
      execute: async (input) => {
        ctx.onTool?.('alertar_agente_humano');
        await ctx.repos.alertarAgenteHumano(ctx.agente, ctx.lead, input as AlertaInput);
        if (input.pausar_bot) ctx.lead.bot_pausado = true;
        return { ok: true, aviso: 'enviado' };
      },
    }),
  };
}
