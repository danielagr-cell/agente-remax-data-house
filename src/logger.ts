import pino from 'pino';

// Logger simple (sin transports externos para no sumar dependencias).
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
});
