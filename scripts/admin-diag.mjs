import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// 1) Probar la clave de Anthropic
try {
  const r = await fetch('https://api.anthropic.com/v1/models', {
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' }
  });
  console.log('== CLAVE ANTHROPIC ==', r.status, r.status === 200 ? 'VALIDA (ok)' : 'PROBLEMA');
  if (r.status !== 200) { const t = await r.text(); console.log('   detalle:', t.slice(0, 200)); }
} catch (e) { console.log('== CLAVE ANTHROPIC == error de red:', e.message); }

// 2) Estado del lead
const num = (process.argv[2] || '').replace(/[^0-9]/g, '');
const suf = num.slice(-8);
try {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await sb.from('leads').select('telefono,bot_pausado').ilike('telefono', '%' + suf + '%');
  if (error) console.log('== LEAD == error:', error.message);
  else if (!data.length) console.log('== LEAD == no existe lead con ...' + suf + ' (=> el mensaje quizas no llego)');
  else data.forEach(l => console.log('== LEAD ==', JSON.stringify({ tel: l.telefono, pausado: l.bot_pausado })));
} catch (e) { console.log('== LEAD == error:', e.message); }
