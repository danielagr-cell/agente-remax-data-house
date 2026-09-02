// Panel web de datos (solo lectura). Modulo OPCIONAL: lo arranca index.ts si existe web-panel.flag.
// Sirve el panel + /api/stats (Supabase con la key del bot). Escucha SOLO en 127.0.0.1 (localhost).
import { createServer, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supabase } from '../db/supabase';
import { logger } from '../logger';

const aca = dirname(fileURLToPath(import.meta.url));
const PANEL_HTML = join(aca, 'panel.html');

function json(res: ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

export function iniciarWeb() {
  const port = Number(process.env.WEB_PORT ?? 3010);
  const host = process.env.WEB_HOST ?? '127.0.0.1';
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${host}:${port}`);
      const p = url.pathname;
      if (p === '/' || p === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(readFileSync(PANEL_HTML, 'utf8'));
        return;
      }
      if (p === '/api/stats') {
        const { data, error } = await supabase.rpc('panel_stats');
        if (error) return json(res, 500, { error: error.message });
        return json(res, 200, data);
      }
      if (p === '/api/whatsapp') {
        return json(res, 200, { lineas: [] });
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    } catch (e) {
      logger.error(e);
      try { json(res, 500, { error: (e as Error).message }); } catch { /* */ }
    }
  });
  server.on('error', (e) => logger.error(`Panel web: ${(e as Error).message}`));
  server.listen(port, host, () => { logger.info(`Panel web en http://${host}:${port}`); try { writeFileSync('web-panel-up.txt', `up @${new Date().toISOString()} ${host}:${port}`); } catch { /* */ } });
  return server;
}
