import * as propsRepo from './propiedades';
import { guardarPerfilLead } from './leads';
import { consultarDisponibilidad, agendarVisita } from './visitas';
import { alertarAgenteHumano } from './notifier';
import type { Repos } from '../agent/tools';

/**
 * Arma el objeto Repos (contrato que usa el dispatcher de herramientas)
 * con las implementaciones reales de Supabase.
 */
export function crearRepos(deps: {
  enviarWhatsApp?: (numeroE164: string, texto: string) => Promise<void>;
}): Repos {
  return {
    buscarPropiedades: propsRepo.buscarPropiedades,
    obtenerDetallePropiedad: propsRepo.obtenerDetallePropiedad,
    guardarPerfilLead,
    consultarDisponibilidad,
    agendarVisita,
    alertarAgenteHumano: (agente, lead, input) => alertarAgenteHumano(agente, lead, input, deps.enviarWhatsApp),
  };
}
