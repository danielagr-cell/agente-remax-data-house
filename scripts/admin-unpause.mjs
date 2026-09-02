import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const num = (process.argv[2] || '').replace(/[^0-9]/g, '');
const suf = num.slice(-8);
if (!suf) { console.error('Pasá un número: node scripts/admin-unpause.mjs <numero>'); process.exit(1); }
const { data, error } = await sb.from('leads').update({ bot_pausado: false }).ilike('telefono', '%' + suf + '%').select('telefono,bot_pausado');
if (error) { console.error('ERROR:', error.message); process.exit(1); }
if (!data || !data.length) console.log('No encontré lead con ...' + suf + ' (tal vez todavía no se creó)');
else data.forEach(l => console.log('DESPAUSADO ->', l.telefono, '| pausado=' + l.bot_pausado));
