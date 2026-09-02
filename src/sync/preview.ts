// Preview del sync: pega contra la API del CRM e imprime la ESTRUCTURA del primer
// listing + cómo queda mapeado, SIN escribir en Supabase (para calibrar el mapeo).
// Uso: `npm run sync:preview`  — solo necesita REMAX_EMAIL / REMAX_PASSWORD en .env.
import { previewListings } from './remaxApiSource';
import { logger } from '../logger';

previewListings()
  .then((r) => {
    logger.info(`Propiedades capturadas: ${r.count}`);
    logger.info('Estructura del primer listing (clave → tipo/muestra):');
    console.log(JSON.stringify(r.shape, null, 2));
    logger.info('Primer listing ya mapeado a PropiedadInput:');
    console.log(JSON.stringify(r.muestra, null, 2));
    process.exit(0);
  })
  .catch((e: Error) => {
    logger.error(e.message);
    process.exit(1);
  });
