import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('FALTA SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env'); process.exit(1); }
const sb = createClient(url, key);

const { data: ag, error } = await sb.from('agentes').select('id,nombre,activo');
if (error) { console.error('ERROR leyendo agentes:', error.message); process.exit(1); }
console.log('ANTES:', JSON.stringify(ag.map(a => ({ id: String(a.id).slice(0,8), nombre: a.nombre, activo: a.activo }))));

let target = ag.find(a => String(a.nombre||'').toLowerCase() === 'daniela') || ag.find(a => a.activo) || ag[0];
if (!target) { console.error('No hay agentes en la base'); process.exit(1); }

let r = await sb.from('agentes').update({ nombre: 'Juan', oficina: 'RE/MAX Data House', activo: true }).eq('id', target.id);
if (r.error) {
  const r2 = await sb.from('agentes').update({ nombre: 'Juan', activo: true }).eq('id', target.id);
  if (r2.error) { console.error('ERROR update:', r2.error.message); process.exit(1); }
  console.log('(la columna oficina no existe; se seteo nombre/activo)');
}
for (const a of ag) if (a.id !== target.id && a.activo) await sb.from('agentes').update({ activo: false }).eq('id', a.id);

const { data: ag2 } = await sb.from('agentes').select('id,nombre,activo');
console.log('DESPUES:', JSON.stringify(ag2.map(a => ({ id: String(a.id).slice(0,8), nombre: a.nombre, activo: a.activo }))));
console.log('OK -> la linea RE/MAX ahora es "Juan" (id ' + String(target.id).slice(0,8) + ')');
