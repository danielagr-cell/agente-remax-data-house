// Runner del sync de catálogo. Uso: `npm run sync:catalogo`
// Se loguea contra la API del CRM de RE/MAX con tus credenciales (.env),
// baja las propiedades activas y las upsertea en Supabase por codigo_remax.
import { validarConfig } from '../config';
import { RemaxApiSource } from './remaxApiSource';
import { sincronizarCatalogo } from './remaxCatalogSync';
import { logger } from '../logger';

validarConfig();
sincronizarCatalogo(new RemaxApiSource())
  .then((r) => {
    logger.info(`Listo: ${r.upserts} propiedades upserteadas.`);
    process.exit(0);
  })
  .catch((e: Error) => {
    logger.error(e.message);
    process.exit(1);
  });
