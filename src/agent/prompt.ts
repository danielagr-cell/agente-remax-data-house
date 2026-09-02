import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Agente, Lead } from '../types';

const aca = dirname(fileURLToPath(import.meta.url));
const RUTA_TEMPLATE = join(aca, '..', '..', 'prompts', 'system_prompt.txt');

let templateCache: string | null = null;

export function cargarTemplate(): string {
  if (templateCache === null) {
    templateCache = readFileSync(RUTA_TEMPLATE, 'utf8');
  }
  return templateCache;
}

/** Reemplaza {{VARIABLES}} en el template. Si falta una, deja el placeholder visible. */
export function construirSystemPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, clave: string) => vars[clave] ?? `{{${clave}}}`);
}

/** Arma el bloque de memoria {{PERFIL_CLIENTE}} a partir del lead. */
export function perfilClienteTexto(lead: Lead): string {
  const partes: string[] = [];
  if (lead.nombre) partes.push(`Nombre: ${lead.nombre}`);
  if (lead.operacion) partes.push(`Operación: ${lead.operacion}`);
  if (lead.tipo_buscado) partes.push(`Tipo buscado: ${lead.tipo_buscado}`);
  if (lead.zonas_interes?.length) partes.push(`Zonas de interés: ${lead.zonas_interes.join(', ')}`);
  if (lead.presupuesto_max) partes.push(`Presupuesto máx: ${lead.presupuesto_max} ${lead.moneda ?? ''}`.trim());
  if (lead.motivo) partes.push(`Motivo: ${lead.motivo}`);
  if (lead.urgencia) partes.push(`Urgencia: ${lead.urgencia}`);
  if (lead.temperatura) partes.push(`Temperatura: ${lead.temperatura}`);
  if (lead.notas) partes.push(`Notas: ${lead.notas}`);
  if (partes.length === 0) return 'Sin datos previos: es la primera vez que escribe o todavía no reveló nada.';
  return partes.join('\n');
}

export function varsDesde(
  agente: Agente,
  lead: Lead,
  opts: { fechaHora: string; origen?: string | null },
): Record<string, string> {
  return {
    AGENTE_NOMBRE: agente.nombre,
    OFICINA: agente.oficina || 'RE/MAX Data House',
    GENERO: (String((agente as any).genero || '').toLowerCase() || (/a$/i.test(String(agente.nombre || '').trim()) ? 'femenino' : 'masculino')),
    AGENTE_MATRICULA: agente.matricula ?? 's/d',
    AGENTE_CODIGO_REFERIDO: agente.codigo_referido,
    ZONAS_COBERTURA: agente.zonas_cobertura.join(', ') || 'varias zonas',
    HORARIO_ATENCION: agente.horario_atencion,
    FECHA_HORA_ACTUAL: opts.fechaHora,
    ORIGEN_LEAD: opts.origen ?? lead.origen ?? 'consulta directa por WhatsApp',
    PERFIL_CLIENTE: perfilClienteTexto(lead),
  };
}

// ============================================================
//  Prompt en capas (lección del CRM): base + inicio + info de negocio + notas
// ============================================================
export interface CapasRuntime {
  fechaHora: string;
  origen?: string | null;
  esNueva: boolean; // charla nueva vs en curso
  businessInfo?: Record<string, unknown> | null;
  notasActivas?: string[]; // correcciones vigentes del equipo
}

function formatBusinessInfo(bi: Record<string, unknown>): string {
  return Object.entries(bi)
    .map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
}

export function componerSystemPrompt(template: string, agente: Agente, lead: Lead, capas: CapasRuntime): string {
  const base = construirSystemPrompt(
    template,
    varsDesde(agente, lead, { fechaHora: capas.fechaHora, origen: capas.origen }),
  );
  const bloques: string[] = [base];

  if (capas.esNueva) {
    bloques.push(
      '<inicio_conversacion>\nEs la primera vez que esta persona te escribe: presentate breve (nombre + oficina) en la primera burbuja.\n</inicio_conversacion>',
    );
  } else {
    const nombre = lead.nombre ? ` La persona se llama ${lead.nombre}.` : '';
    bloques.push(
      `<inicio_conversacion>\nLa conversación ya venía de antes: NO te vuelvas a presentar ni repitas lo ya dicho, retomá con naturalidad.${nombre}\n</inicio_conversacion>`,
    );
  }

  if (capas.businessInfo && Object.keys(capas.businessInfo).length > 0) {
    bloques.push(
      `<info_del_negocio>\nDatos duros que SÍ podés afirmar (si no está acá ni en una tool, no lo digas):\n${formatBusinessInfo(
        capas.businessInfo,
      )}\n</info_del_negocio>`,
    );
  }

  if (capas.notasActivas && capas.notasActivas.length > 0) {
    bloques.push(
      `<correcciones_vigentes>\nInstrucciones del equipo, respetalas siempre:\n${capas.notasActivas
        .map((n) => `- ${n}`)
        .join('\n')}\n</correcciones_vigentes>`,
    );
  }

  return bloques.join('\n\n');
}
// reload prompt (reclutamiento)

// reload (metodologia de ventas Daniela)

// reload (identidad por tenant)
