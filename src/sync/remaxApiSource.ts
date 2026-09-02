// Cliente directo de la API del CRM de RE/MAX (reemplaza el login headless con Playwright).
//
//   1) POST {API}/auth/v1/qrlistings/login  body {"user":{"username","password"}} → id_token (JWT, ~15 min)
//   2) GET  {API}/listings/api/listings?...&page=N&pageSize=100  con Authorization: Bearer <id_token>
//      → { data: { results, page, pageSize, totalItems, totalPages, filters }, code, message, errors }
//
// Sin navegador: es estable, rápido y no depende de los selectores del front.
import { config } from '../config';
import { logger } from '../logger';
import { mapListing } from './listingMapper';
import type { FuenteCatalogo, PropiedadInput } from './remaxCatalogSync';

const PAGE_SIZE = 100;

// Mismos filtros que aplica el panel "Mis propiedades" del CRM: solo las activas de la agente.
const FILTROS_CATALOGO: Array<[string, string]> = [
  ['associateStatus', 'active'],
  ['combineStatus', 'Activas'],
  ['excludeStatus', 'expired'],
  ['excludeStatus', 'completed'],
  ['excludeStatus', 'canceled'],
  ['excludeStatus', 'deleted'],
];

interface RespuestaLogin {
  id_token?: string;
  refreshToken?: string;
  message?: string;
}

interface RespuestaListings {
  data?: {
    results?: unknown[];
    page?: number;
    pageSize?: number;
    totalItems?: number;
    totalPages?: number;
  };
  message?: string;
}

/** Login contra el CRM. Devuelve el JWT que firma las llamadas al catálogo. */
export async function login(): Promise<string> {
  if (!config.remax.email || !config.remax.password) {
    throw new Error('Faltan REMAX_EMAIL / REMAX_PASSWORD en .env para el login del sync.');
  }

  const res = await fetch(`${config.remax.apiUrl}/auth/v1/qrlistings/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      user: { username: config.remax.email, password: config.remax.password },
    }),
  });

  const cuerpo = (await res.json().catch(() => ({}))) as RespuestaLogin;
  if (!res.ok || !cuerpo.id_token) {
    throw new Error(
      `Login RE/MAX falló (${res.status}): ${cuerpo.message ?? 'sin token en la respuesta'}. ` +
        'Revisá REMAX_EMAIL / REMAX_PASSWORD.',
    );
  }
  logger.info('Login RE/MAX OK (token de catálogo obtenido).');
  return cuerpo.id_token;
}

function urlListings(pagina: number): string {
  const qs = new URLSearchParams();
  for (const [k, v] of FILTROS_CATALOGO) qs.append(k, v);
  qs.append('page', String(pagina));
  qs.append('pageSize', String(PAGE_SIZE));
  return `${config.remax.apiUrl}/listings/api/listings?${qs.toString()}`;
}

async function traerPagina(token: string, pagina: number): Promise<{ items: any[]; totalPages: number; totalItems: number }> {
  const res = await fetch(urlListings(pagina), {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`GET listings página ${pagina} falló (${res.status}).`);
  }
  const cuerpo = (await res.json()) as RespuestaListings;
  const items = (cuerpo.data?.results ?? []) as any[];
  return {
    items,
    totalPages: cuerpo.data?.totalPages ?? 1,
    totalItems: cuerpo.data?.totalItems ?? items.length,
  };
}

/** Trae TODAS las propiedades activas del CRM, paginando hasta agotar totalPages. */
export async function capturarListingsCrudos(): Promise<any[]> {
  const token = await login();

  const primera = await traerPagina(token, 1);
  const todos = [...primera.items];
  logger.info(`Catálogo: ${primera.totalItems} propiedades en ${primera.totalPages} páginas.`);

  for (let p = 2; p <= primera.totalPages; p++) {
    const { items } = await traerPagina(token, p);
    if (items.length === 0) break;
    todos.push(...items);
  }

  // Dedup defensivo por mlsid (la paginación del CRM puede repetir en el borde).
  const vistos = new Set<string>();
  const unicos = todos.filter((l) => {
    const id = String(l?.mlsid ?? l?.id ?? '');
    if (!id || vistos.has(id)) return false;
    vistos.add(id);
    return true;
  });

  logger.info(`Capturadas ${unicos.length} propiedades del CRM.`);
  return unicos;
}

/** Fuente de catálogo para el pipeline de sync (API → mapeo → upsert). */
export class RemaxApiSource implements FuenteCatalogo {
  nombre = 'RE/MAX (API del CRM)';
  async obtenerPropiedades(): Promise<PropiedadInput[]> {
    const listings = await capturarListingsCrudos();
    return listings.map(mapListing).filter((p): p is PropiedadInput => p !== null);
  }
}

/** Modo preview: estructura del primer listing crudo + una muestra ya mapeada, sin tocar la DB. */
export async function previewListings(): Promise<{
  count: number;
  shape: Record<string, string>;
  muestra: PropiedadInput | null;
}> {
  const listings = await capturarListingsCrudos();
  const first = (listings[0] ?? {}) as Record<string, unknown>;
  const shape: Record<string, string> = {};
  for (const k of Object.keys(first)) shape[k] = resumirValor(first[k]);
  return { count: listings.length, shape, muestra: listings[0] ? mapListing(listings[0]) : null };
}

function resumirValor(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array[${v.length}]` + (v[0] !== undefined ? ` de ${typeof v[0]}` : '');
  if (typeof v === 'object') return `object{${Object.keys(v as object).slice(0, 8).join(',')}}`;
  const s = String(v);
  return `${typeof v}: ${s.length > 24 ? s.slice(0, 24) + '…' : s}`;
}
