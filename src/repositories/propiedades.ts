import { supabase } from '../db/supabase';
import type { Propiedad } from '../types';
import type { BuscarPropiedadesInput } from '../agent/tools';

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Normaliza para comparar zonas sin importar mayúsculas ni acentos.
// (Descompone en NFD y saca los signos combinantes U+0300–U+036F por code point,
//  así evitamos meter caracteres invisibles en el fuente.)
function norm(s?: string | null): string {
  const nfd = (s ?? '').toString().toLowerCase().normalize('NFD');
  let out = '';
  for (const ch of nfd) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x300 && c <= 0x36f) continue; // diacríticos combinantes
    out += ch;
  }
  return out.trim();
}

/**
 * Búsqueda con matcher. Si hay match exacto lo devuelve primero; si no,
 * recomienda lo más parecido (presupuesto un poco por encima, zona vecina, o
 * con algún dato sin confirmar). Filtra en SQL solo lo DURO (estado, operación,
 * tipo, moneda) y rankea el resto en memoria por cercanía.
 *
 * Reglas clave:
 * - Nunca inventa: solo devuelve filas reales del catálogo.
 * - `ambientes`/`dormitorios` en 0 o null = "sin dato": NO descarta la propiedad
 *   (el CRM trae muchos huecos), solo penaliza suave.
 * - El presupuesto tolera hasta +15% cómodo y +50% como último recurso.
 *
 * Nota de escala: el catálogo es chico (~670), así que traemos los candidatos y
 * rankeamos en memoria. Si algún día crece mucho, se pre-filtra más en SQL.
 */
export async function buscarPropiedades(input: BuscarPropiedadesInput): Promise<Propiedad[]> {
  let q = supabase
    .from('propiedades')
    .select('*')
    .eq('estado', 'disponible')
    .eq('operacion', input.operacion);
  if (input.tipo) q = q.eq('tipo', input.tipo);
  if (input.moneda) q = q.eq('moneda', input.moneda);

  const { data, error } = await q.limit(800);
  if (error) throw new Error(`buscarPropiedades: ${error.message}`);
  const candidatos = (data ?? []) as Propiedad[];
  if (candidatos.length === 0) return [];

  const zonas = (input.zonas ?? []).map(norm).filter(Boolean);
  const pmax = input.presupuesto_max;
  const pmin = input.presupuesto_min;

  // Menor score = más parecido. `null` = descartar (muy fuera de rango).
  function score(p: Propiedad): number | null {
    let s = 0;

    // Presupuesto: dentro es ideal; hasta +15% cómodo; hasta +50% penaliza fuerte; más, fuera.
    if (typeof pmax === 'number' && pmax > 0 && typeof p.precio === 'number') {
      const r = p.precio / pmax;
      if (r <= 1) s += 0;
      else if (r <= 1.15) s += 3;
      else if (r <= 1.5) s += 8;
      else return null;
    }
    if (typeof pmin === 'number' && typeof p.precio === 'number' && p.precio < pmin * 0.7) return null;

    // Zona: exacta ideal; misma zona/partido aprox (contiene) ok; otra zona penaliza pero no descarta.
    if (zonas.length) {
      const z = norm(p.zona);
      const dir = norm(p.direccion);
      const exacta = zonas.some((zb) => z === zb);
      const cerca = zonas.some((zb) => z.includes(zb) || zb.includes(z) || dir.includes(zb));
      s += exacta ? 0 : cerca ? 2 : 6;
    }

    // Ambientes / dormitorios: 0 o null = sin dato (no descarta). Menos de lo pedido penaliza.
    if (typeof input.ambientes === 'number') {
      const a = p.ambientes ?? 0;
      s += a === 0 ? 2 : a >= input.ambientes ? 0 : (input.ambientes - a) * 2;
    }
    if (typeof input.dormitorios === 'number') {
      const d = p.dormitorios ?? 0;
      s += d === 0 ? 2 : d >= input.dormitorios ? 0 : (input.dormitorios - d) * 2;
    }

    // Cochera pedida y no la tiene: penaliza suave.
    if (input.cochera === true && !p.cochera) s += 3;

    return s;
  }

  return candidatos
    .map((p) => ({ p, s: score(p) }))
    .filter((x): x is { p: Propiedad; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || (a.p.precio ?? Infinity) - (b.p.precio ?? Infinity))
    .slice(0, 5)
    .map((x) => x.p);
}

export async function obtenerDetallePropiedad(id: string): Promise<Propiedad | null> {
  const columna = RE_UUID.test(id) ? 'id' : 'codigo_remax';
  const { data, error } = await supabase.from('propiedades').select('*').eq(columna, id).maybeSingle();
  if (error) throw new Error(`obtenerDetallePropiedad: ${error.message}`);
  return (data as Propiedad | null) ?? null;
}
