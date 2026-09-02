// Runner de la revisión nocturna. Uso: `npm run review` (ideal como cron diario).
import { validarConfig } from '../config';
import { correrRevisionNocturna } from './nightly';
import { logger } from '../logger';

validarConfig();
correrRevisionNocturna()
  .then((r) => {
    logger.info(`Listo: ${r.leads} leads revisados, ${r.notas} notas generadas.`);
    process.exit(0);
  })
  .catch((e: Error) => {
    logger.error(e.message);
    process.exit(1);
  });
