// Test del núcleo v0.2 SIN red ni env: cubre las piezas deterministas nuevas
//   - split de burbujas
//   - link con referido
//   - prompt en capas (inicio + business_info + notas activas)
//   - tools (createTools) con fake repos
//   - cadena de modelos con fallback (salto por cuota + reintento por transitorio)
//   - clasificadores de error
// Correr: `npm test`

import { splitMessage } from '../whatsapp/sender';
import { createTools, linkConReferido, type Repos } from '../agent/tools';
import { conFallback, esTransitorio, esCuotaOKeyInvalida, type ModeloEntry } from '../agent/llm';
import { componerSystemPrompt } from '../agent/prompt';
import type { Agente, Lead, Propiedad, Slot } from '../types';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`❌ ${msg}`);
  console.log(`✅ ${msg}`);
}

const agente: Agente = {
  id: 'ag-1',
  nombre: 'Daniela',
  oficina: 'RE/MAX Data House',
  matricula: 'CUCICBA 0000',
  codigo_referido: 'daniela-dh',
  whatsapp_numero: '5491100000001',
  telefono_alertas: '5491111111111',
  zonas_cobertura: ['Caballito', 'Flores'],
  horario_atencion: 'Lun a Sáb, 9 a 19 h',
  tono: 'ejecutivo cercano',
  business_info: {},
  activo: true,
};

const lead: Lead = {
  id: 'lead-1',
  agente_id: 'ag-1',
  telefono: '5491133334444',
  zonas_interes: [],
  temperatura: 'frio',
  estado_funnel: 'nuevo',
  bot_pausado: false,
};

const propiedadDemo: Propiedad = {
  id: 'prop-1',
  codigo_remax: 'RMX-00421',
  operacion: 'venta',
  tipo: 'departamento',
  titulo: 'Depto 2 amb a estrenar en Caballito',
  zona: 'Caballito',
  precio: 95000,
  moneda: 'USD',
  ambientes: 2,
  cochera: false,
  apto_credito: true,
  extras: ['balcón', 'luminoso'],
  link_oficial: 'https://www.remax.com.ar/listings/RMX-00421',
  estado: 'disponible',
};

const repos: Repos = {
  async buscarPropiedades() {
    return [propiedadDemo];
  },
  async obtenerDetallePropiedad() {
    return propiedadDemo;
  },
  async guardarPerfilLead(l, patch) {
    Object.assign(l, patch);
  },
  async consultarDisponibilidad(): Promise<Slot[]> {
    return [{ id: 's1', inicio: '2026-08-27T17:00:00-03:00', fin: '2026-08-27T18:00:00-03:00', etiqueta: 'miércoles 27/08 a las 17:00' }];
  },
  async agendarVisita() {
    return { ok: true, etiqueta: 'miércoles 27/08 a las 17:00' };
  },
  async alertarAgenteHumano() {
    /* no-op */
  },
};

async function run(): Promise<void> {
  console.log('— Dry run v0.2 —\n');

  // 1. Split de burbujas
  assert(splitMessage('a|||b|||c', '|||').length === 3, 'splitMessage fracciona en 3 burbujas');

  // 2. Link con referido
  assert(linkConReferido(propiedadDemo, 'daniela-dh').includes('ref=daniela-dh'), 'linkConReferido agrega el código de referido');

  // 3. Prompt en capas
  const tpl = 'Sos {{AGENTE_NOMBRE}} de {{OFICINA}}. Perfil: {{PERFIL_CLIENTE}}';
  const sp = componerSystemPrompt(tpl, agente, lead, {
    fechaHora: 'hoy',
    esNueva: true,
    businessInfo: { medios_de_pago: 'transferencia' },
    notasActivas: ['Confirmá la zona antes de la visita'],
  });
  assert(sp.includes('Daniela') && sp.includes('RE/MAX Data House'), 'el prompt inyecta identidad de la agente');
  assert(sp.includes('inicio_conversacion'), 'incluye el bloque de inicio');
  assert(sp.includes('info_del_negocio') && sp.includes('transferencia'), 'incluye la capa de business_info');
  assert(sp.includes('correcciones_vigentes') && sp.includes('Confirmá la zona'), 'incluye las notas activas');

  // 4. Tools (createTools + fake repos)
  const tools = createTools({ agente, lead, repos });
  const resBuscar: any = await (tools.buscar_propiedades as any).execute({ operacion: 'venta', zonas: ['Caballito'] }, {});
  assert(resBuscar.encontradas === 1, 'buscar_propiedades devuelve resultados');
  assert(String(resBuscar.propiedades[0].link).includes('ref=daniela-dh'), 'los resultados llevan el link con referido');

  await (tools.guardar_perfil_lead as any).execute({ temperatura: 'tibio', presupuesto_max: 100000 }, {});
  assert(lead.temperatura === 'tibio' && lead.presupuesto_max === 100000, 'guardar_perfil_lead actualiza el lead en memoria');

  // 5. Cadena de modelos con fallback
  const chain: ModeloEntry[] = [
    { nombre: 'm1', crear: () => ({}) },
    { nombre: 'm2', crear: () => ({}) },
  ];
  const r1 = await conFallback(chain, async (e) => {
    if (e.nombre === 'm1') {
      const err: any = new Error('Unauthorized');
      err.statusCode = 401;
      throw err;
    }
    return { text: 'ok', steps: [], modelo: e.nombre };
  });
  assert(r1.modelo === 'm2', 'ante cuota/key inválida salta al siguiente modelo');

  let intentos = 0;
  const r2 = await conFallback([{ nombre: 'm1', crear: () => ({}) }], async () => {
    intentos++;
    if (intentos < 3) throw new Error('fetch failed');
    return { text: 'ok', steps: [], modelo: 'm1' };
  });
  assert(intentos === 3 && r2.text === 'ok', 'reintenta ante error transitorio y termina OK');

  // 6. Clasificadores
  assert(esCuotaOKeyInvalida({ statusCode: 401 }), '401 se clasifica como cuota/key inválida');
  assert(esTransitorio({ statusCode: 503 }), '503 se clasifica como transitorio');
  assert(!esTransitorio({ statusCode: 400 }), '400 no es transitorio');

  console.log('\n🎉 v0.2 OK: fallback de modelos, prompt en capas, tools con referido y split funcionan.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
