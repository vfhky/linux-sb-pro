// Tiny HTTP server that serves linux-sb-suite.user.js from disk.
// Used as the @updateURL / @downloadURL source so Tampermonkey can auto-update.
//
// Usage:  node serve.mjs [port]
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const PORT = Number(process.argv[2] || process.env.LSB_SERVE_PORT || 8123);
const ROOT = process.cwd();
// Default to the BUILT dist version so Tampermonkey always gets a
// self-contained userscript with the inlined lib/core bundles. Override
// with LSB_SERVE_FILE if you need to serve the raw dev source.
const SCRIPT = process.env.LSB_SERVE_FILE || 'dist/linux-sb-suite.user.js';

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.user.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

const server = createServer((req, res) => {
  const ts = new Date().toISOString().slice(11, 19);
  try {
    let url = req.url.split('?')[0];
    if (url === '/' || url === '/index.html') url = '/' + SCRIPT;
  // Also map the conventional name to the same served file so the
  // dev source's @updateURL (http://127.0.0.1:PORT/linux-sb-suite.user.js)
  // resolves to the built dist file.
  if (url === '/linux-sb-suite.user.js') url = '/' + SCRIPT;
    const filePath = join(ROOT, url.replace(/^\//, ''));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    const stat = statSync(filePath);
    if (!stat.isFile()) { res.writeHead(404); res.end('not found'); return; }
    const body = readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
    console.log(`[${ts}] ${req.method} ${url} -> ${body.length} bytes`);
  } catch (err) {
    if (err.code === 'ENOENT') { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(500); res.end(String(err));
    console.error(`[${ts}] ERR ${req.method} ${req.url}: ${err.message}`);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serve.mjs listening on http://127.0.0.1:${PORT}/`);
  console.log(`  -> http://127.0.0.1:${PORT}/${SCRIPT}`);
  console.log(`Tampermonkey will fetch this URL on "Trigger Update" / check.`);
});

process.on('SIGINT', () => { server.close(); process.exit(0); });
