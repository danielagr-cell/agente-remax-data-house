import { supabase } from '../db/supabase';
import { logger } from '../logger';

// Forma normalizada de una propiedad que entra al catálogo.
export interface PropiedadInput {
  codigo_remax: string;
  operacion: 'venta' | 'alquiler' | 'alquiler_temporario';
  tipo: string;
  titulo: string;
  zona: string;
  direccion?: string;
  precio?: number;
  moneda?: 'USD' | 'ARS';
  ambientes?: number;
  dormitorios?: number;
  banos?: number;
  cochera?: boolean;
  metros_cubiertos?: number;
  metros_totales?: number;
  expensas?: number;
  apto_credito?: boolean;
  a_estrenar?: boolean;
  extras?: string[];
  descripcion?: string;
  link_oficial?: string;
  estado?: string;
}

export interface FuenteCatalogo {
  nombre: string;
  obtenerPropiedades(): Promise<PropiedadInput[]>;
}

/**
 * Adaptador para el CRM NACIONAL de RE/MAX (la fuente real del catálogo).
 *
 * Elegí el método de acceso disponible y completá obtenerPropiedades():
 *   (a) API oficial del CRM  → fetch autenticado y map a PropiedadInput[]  (recomendado)
 *   (b) Export CSV / Excel   → leer el archivo periódico y parsear
 *   (c) Feed XML de portal   → parsear el feed (formato tipo Tokko / portales)
 *
 * El resto del pipeline (upsert en Supabase por codigo_remax) ya está resuelto abajo.
 */
export class RemaxCrmSource implements FuenteCatalogo {
  nombre = 'RE/MAX CRM (nacional)';

  async obtenerPropiedades(): Promise<PropiedadInput[]> {
    throw new Error(
      'Sync RE/MAX pendiente: definí el método de acceso (API / export CSV / feed XML) ' +
        'y completá RemaxCrmSource.obtenerPropiedades().',
    );
  }
}

/** Fuente de prueba: sirve para validar el pipeline de upsert sin el CRM real. */
export class FuenteDemo implements FuenteCatalogo {
  nombre = 'demo';
  constructor(private readonly items: PropiedadInput[]) {}
  async obtenerPropiedades(): Promise<PropiedadInput[]> {
    return this.items;
  }
}

export async function sincronizarCatalogo(fuente: FuenteCatalogo): Promise<{ upserts: number }> {
  logger.info(`Sincronizando catálogo desde: ${fuente.nombre}`);
  const props = await fuente.obtenerPropiedades();
  if (props.length === 0) return { upserts: 0 };

  const filas = props.map((p) => ({
    ...p,
    moneda: p.moneda ?? 'USD',
    estado: p.estado ?? 'disponible',
    actualizado_crm_at: new Date().toISOString(),
  }));

  const { error, count } = await supabase
    .from('propiedades')
    .upsert(filas, { onConflict: 'codigo_remax', count: 'exact' });
  if (error) throw new Error(`sincronizarCatalogo: ${error.message}`);

  const n = count ?? filas.length;
  logger.info(`Catálogo sincronizado: ${n} propiedades.`);
  return { upserts: n };
}
