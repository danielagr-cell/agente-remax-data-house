// Mapeo de un listing crudo del CRM de RE/MAX → PropiedadInput del catálogo.
// Tolerante a nombres de campo: la API real usa `mlsid` / `type` / `dimensions`,
// pero se mantienen los alias por si cambia el shape entre entornos.
import type { PropiedadInput } from './remaxCatalogSync';

function pick(obj: any, keys: string[]): any {
  for (const k of keys) if (obj?.[k] !== undefined && obj?.[k] !== null) return obj[k];
  return undefined;
}
function num(v: any): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}
function str(v: any): string | undefined {
  return v === undefined || v === null ? undefined : String(v);
}
function mapTipo(raw: string): string {
  const s = raw.toLowerCase();
  if (/casa|house/.test(s)) return 'casa';
  if (/\bph\b/.test(s)) return 'ph';
  if (/mono/.test(s)) return 'monoambiente';
  if (/terreno|lote|land/.test(s)) return 'terreno';
  if (/local|comercial/.test(s)) return 'local';
  if (/oficina|office/.test(s)) return 'oficina';
  if (/cochera|garage|parking/.test(s)) return 'cochera';
  if (/galpon|dep[oó]sito|warehouse/.test(s)) return 'galpon';
  return 'departamento';
}

export function mapListing(l: any): PropiedadInput | null {
  const codigo = String(pick(l, ['mlsid', 'mlsId', 'code', 'listingId', 'listingid', 'id']) ?? '').trim();
  if (!codigo) return null;

  // La API devuelve la operación en `type` ("sale" | "rent"); el resto son alias defensivos.
  const operacionRaw = String(
    pick(l, ['transactionType', 'operationType', 'operation', 'listingType', 'tipoOperacion', 'type']) ?? '',
  ).toLowerCase();
  const operacion: PropiedadInput['operacion'] = /alq|rent|arriend/.test(operacionRaw)
    ? /temp/.test(operacionRaw)
      ? 'alquiler_temporario'
      : 'alquiler'
    : 'venta';

  const tipo = mapTipo(String(pick(l, ['propertyType', 'tipo', 'propertytype']) ?? ''));

  const precioObj = pick(l, ['price', 'listPrice', 'precio']);
  let precio: number | undefined;
  let moneda = 'USD';
  if (precioObj && typeof precioObj === 'object') {
    precio = num(precioObj.value ?? precioObj.amount ?? precioObj.price);
    moneda = String(precioObj.currency ?? precioObj.currencyId ?? 'USD').toUpperCase().includes('ARS') ? 'ARS' : 'USD';
  } else {
    precio = num(precioObj);
    moneda = String(pick(l, ['currency', 'currencyId', 'moneda']) ?? 'USD').toUpperCase().includes('ARS') ? 'ARS' : 'USD';
  }

  const addr = pick(l, ['address', 'location', 'ubicacion', 'direccion']) ?? {};
  // El CRM suele traer neighborhood en null: caemos a city → county → subregion.
  const zona =
    String(
      (typeof addr === 'object'
        ? pick(addr, ['neighborhood', 'privatecommunity', 'city', 'county', 'subregion', 'locality', 'zone', 'area'])
        : undefined) ??
        pick(l, ['neighborhood', 'city', 'zona', 'barrio']) ??
        '',
    ).trim() || 'Sin zona';
  const titulo = String(
    pick(l, ['title', 'titulo', 'displayAddress', 'fullAddress']) ??
      (typeof addr === 'object' ? pick(addr, ['displayAddress', 'fullAddress', 'formatted', 'line1']) : undefined) ??
      `${tipo} en ${zona}`,
  ).slice(0, 200);

  // `dimensions`: land / totalBuilt / covered / uncovered / semicovered.
  const dims = pick(l, ['dimensions']) ?? {};
  const cubiertos =
    num(pick(dims, ['covered', 'totalBuilt'])) ??
    num(pick(l, ['coveredSurface', 'coveredArea', 'metrosCubiertos', 'builtArea']));

  // Superficie total: en terrenos manda el lote (`land`); en el resto, lo construido.
  const totales =
    tipo === 'terreno'
      ? num(pick(dims, ['land', 'totalBuilt']))
      : num(pick(dims, ['totalBuilt', 'land']));

  const direccion =
    typeof addr === 'object' ? str(pick(addr, ['displayAddress', 'fullAddress', 'formatted'])) : undefined;

  // `maintenance`: { fee, currency } — fee null cuando no hay expensas.
  const mant = pick(l, ['maintenance']) ?? {};
  const expensas = num(pick(mant, ['fee'])) ?? num(pick(l, ['expenses', 'expensas', 'maintenanceFee']));

  const condicion = String(pick(l, ['propertyCondition', 'condition']) ?? '').toLowerCase();

  // Link PÚBLICO compartible (remax.com.ar) — el que abre el cliente. El ?associate= del agente
  // lo agrega linkConReferido al enviar. (Antes: redremax.com/listings = CRM interno, pide login.)
  const link = `https://www.remax.com.ar/${codigo}`;

  return {
    codigo_remax: codigo,
    operacion,
    tipo,
    titulo,
    zona,
    direccion,
    precio,
    moneda: moneda as 'USD' | 'ARS',
    ambientes: num(pick(l, ['totalRooms', 'rooms', 'ambientes'])),
    dormitorios: num(pick(l, ['bedrooms', 'dormitorios'])),
    banos: num(pick(l, ['bathrooms', 'banos', 'fullBathrooms'])),
    cochera: (num(pick(l, ['parkingSpaces', 'garages', 'cochera'])) ?? 0) > 0,
    metros_cubiertos: cubiertos,
    metros_totales: totales,
    expensas,
    apto_credito: Boolean(pick(l, ['aptCredit', 'apto_credito'])),
    a_estrenar: /estrenar|nuevo|brand new/.test(condicion) || Boolean(pick(l, ['pozo'])),
    descripcion: str(pick(l, ['description', 'descripcion'])),
    link_oficial: link,
    estado: 'disponible',
  };
}
