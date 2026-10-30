// ISSB ASPIRANTS — tiny local web server (no dependencies).
// Run by double-clicking "Start ISSB Site.bat", or with:  node serve.mjs
// Serving over http://localhost (instead of double-clicking index.html) is what
// Supabase auth expects; opening the file directly (file://) can stall sign-in.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = 8000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8'
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    let rel = normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
    if (rel.endsWith(sep) || rel === '/' || rel === '') rel = join(rel, 'index.html');
    const filePath = resolve(join(ROOT, rel));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found: ' + (req.url || '/'));
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/index.html`;
  console.log('============================================');
  console.log('  ISSB ASPIRANTS local server is running');
  console.log('  ' + url);
  console.log('============================================');
  console.log('Keep this window open while you use the site.');
  console.log('Close the window (or press Ctrl+C) to stop the server.');
  if (process.env.ISSB_NO_OPEN) return;
  const opener = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(opener);
});
