// Promueve una nota de revisión a corrección activa del prompt.
// Uso: `npm run review:promote <id_nota>`
import { validarConfig } from '../config';
import { promoverNota } from '../repositories/review';
import { logger } from '../logger';

const id = process.argv[2];
if (!id) {
  logger.error('Uso: npm run review:promote <id_nota>');
  process.exit(1);
}

validarConfig();
promoverNota(id)
  .then((contenido) => {
    logger.info(`✅ Nota promovida a corrección activa: "${contenido}"`);
    process.exit(0);
  })
  .catch((e: Error) => {
    logger.error(e.message);
    process.exit(1);
  });
