// Diagnóstico de proveedores de modelo para el bot RE/MAX Data House.
// NO imprime ninguna API key completa. Solo: tipo de key (por prefijo), largo,
// dónde está puesta cada una, si hay una key en la variable equivocada, si hay
// un segundo .env que te esté confundiendo, y el resultado de una llamada real.
//
// Correr desde la raíz del repo:   node diag-modelos.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

// --- leer .env sin depender de dotenv ---
function parseEnv(path) {
  const out = {};
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

let env;
try {
  env = parseEnv(join(root, '.env'));
} catch (e) {
  console.log('❌ No pude leer .env en', root, '->', e.message);
  process.exit(1);
}

// --- clasificar una key por su prefijo (identifica el TIPO, no el secreto) ---
function tipoDeKey(v) {
  if (!v) return 'AUSENTE';
  if (v.startsWith('sk-ant-')) return 'Anthropic (sk-ant-)';
  if (v.startsWith('sk-or-')) return 'OpenRouter (sk-or-)';
  if (v.startsWith('sk-proj-')) return 'OpenAI proyecto (sk-proj-)';
  if (v.startsWith('sk-')) return 'OpenAI clásica (sk-)';
  if (v.startsWith('sb_secret_')) return 'Supabase SECRET (sb_secret_)';
  if (v.startsWith('sb_publishable_')) return 'Supabase PÚBLICA (sb_publishable_)';
  if (v.startsWith('eyJ')) return 'JWT (token / Supabase legacy)';
  if (v.startsWith('AIza')) return 'Google clásica (AIza)';
  return `DESCONOCIDO (${v.length} chars, empieza "${v.slice(0, 4)}…")`;
}

console.log('\n===== QUÉ HAY EN CADA VARIABLE (tipo, no el valor) =====');
const esperado = {
  ANTHROPIC_API_KEY: 'Anthropic (sk-ant-)',
  OPENROUTER_API_KEY: 'OpenRouter (sk-or-)',
  OPENAI_API_KEY: 'OpenAI',
  GOOGLE_GENERATIVE_AI_API_KEY: 'Google',
  SUPABASE_SERVICE_ROLE_KEY: 'Supabase SECRET',
};
for (const [k, esp] of Object.entries(esperado)) {
  const tipo = tipoDeKey(env[k]);
  const largo = env[k] ? `${env[k].length} chars` : '';
  const alerta = env[k] && !tipo.toLowerCase().includes(esp.split(' ')[0].toLowerCase()) && tipo !== 'AUSENTE'
    ? '   ⚠  NO coincide con lo esperado aquí'
    : '';
  console.log(`${k.padEnd(30)}: ${tipo} ${largo}${alerta}`);
}
console.log(`${'AGENT_PRIMARY'.padEnd(30)}: ${env.AGENT_PRIMARY || '(default anthropic)'}`);
console.log(`${'GOOGLE_MODEL'.padEnd(30)}: ${env.GOOGLE_MODEL || '(default en código)'}`);

// --- ¿hay una key Anthropic (sk-ant-) metida en OTRA variable? ---
console.log('\n===== ¿ESTÁ TU KEY ANTHROPIC EN EL LUGAR EQUIVOCADO? =====');
const dondeHayAnt = Object.entries(env).filter(([, v]) => v && v.startsWith('sk-ant-')).map(([k]) => k);
if (dondeHayAnt.length === 0) {
  console.log('No hay NINGUNA key que empiece con sk-ant- en este .env.');
  console.log('=> Tu key de Anthropic no está en este archivo (o no es una sk-ant-). Hay que pegar una nueva en ANTHROPIC_API_KEY.');
} else if (dondeHayAnt.length === 1 && dondeHayAnt[0] === 'ANTHROPIC_API_KEY') {
  console.log('OK: hay una sk-ant- y está en ANTHROPIC_API_KEY (el lugar correcto).');
} else {
  console.log('⚠  Hay una key sk-ant- pero en la/s variable/s:', dondeHayAnt.join(', '));
  console.log('=> Movéla a ANTHROPIC_API_KEY.');
}

// --- ¿hay un segundo .env que te esté confundiendo? ---
console.log('\n===== ¿EDITANDO EL .env EQUIVOCADO? =====');
console.log('El bot lee ESTE:', join(root, '.env'));
for (const otro of [join(root, '..', '.env'), join(root, '..', '..', '.env')]) {
  if (existsSync(otro)) console.log('⚠  OJO: también existe otro .env acá (el bot NO lo usa):', otro);
}

const short = (s) => String(s ?? '').replace(/\s+/g, ' ').slice(0, 220);
async function probar(nombre, fn) {
  try {
    const r = await fn();
    console.log(r.ok ? `✅ ${nombre}: OK (status ${r.status})` : `❌ ${nombre}: FALLA (status ${r.status}) -> ${short(r.msg)}`);
  } catch (e) {
    console.log(`❌ ${nombre}: EXCEPCIÓN -> ${short(e.message)}`);
  }
}

async function main() {
  console.log('\n===== PRUEBAS EN VIVO (llamada mínima a cada proveedor) =====');

  if (env.ANTHROPIC_API_KEY) {
    await probar(`Anthropic (${env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'})`, async () => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-sonnet-4-5', max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }),
      });
      const t = await res.text();
      let msg = t; try { const j = JSON.parse(t); msg = j.error ? `${j.error.type}: ${j.error.message}` : 'respondió'; } catch {}
      return { ok: res.ok, status: res.status, msg };
    });
  } else console.log('— Anthropic: sin key, salteado');

  if (env.OPENROUTER_API_KEY) {
    await probar(`OpenRouter (${env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4-5'})`, async () => {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4-5', max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }),
      });
      const t = await res.text();
      let msg = t; try { const j = JSON.parse(t); msg = j.error ? (j.error.message || JSON.stringify(j.error)) : 'respondió'; } catch {}
      return { ok: res.ok, status: res.status, msg };
    });
  } else console.log('— OpenRouter: sin key, salteado');

  if (env.OPENAI_API_KEY) {
    await probar(`OpenAI (${env.OPENAI_MODEL || 'gpt-4o'})`, async () => {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-4o', max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }),
      });
      const t = await res.text();
      let msg = t; try { const j = JSON.parse(t); msg = j.error ? `${j.error.type || j.error.code}: ${j.error.message}` : 'respondió'; } catch {}
      return { ok: res.ok, status: res.status, msg };
    });
  } else console.log('— OpenAI: sin key, salteado');

  if (env.GOOGLE_GENERATIVE_AI_API_KEY) {
    await probar(`Google (${env.GOOGLE_MODEL || 'gemini-flash-latest'})`, async () => {
      const model = env.GOOGLE_MODEL || 'gemini-flash-latest';
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': env.GOOGLE_GENERATIVE_AI_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }] }),
      });
      const t = await res.text();
      let msg = t; try { const j = JSON.parse(t); msg = j.error ? `${j.error.status}: ${j.error.message}` : 'respondió'; } catch {}
      return { ok: res.ok, status: res.status, msg };
    });
  } else console.log('— Google: sin key, salteado');

  console.log('\n===== FIN =====\n');
}

main();
