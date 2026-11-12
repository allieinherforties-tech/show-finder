// Static-first serving: the server loads the prebuilt artifact and the SQLite
// FTS5 database into memory at startup and answers queries from them. There is
// no catalog source in the serving path. Query interpretation runs here, at
// the edge of the app, before the indexes see the text.

import { createServer as createHttpServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIndex, ARTIFACT_PATH, DB_PATH } from './search/store.mjs';

// The swappable artwork layer. One configuration flag, set per deploy:
//   ARTWORK_MODE=tmdb (default): result cards render attributed TMDB episode
//     stills and posters, hotlinked from image.tmdb.org.
//   ARTWORK_MODE=text: Phase 1 text-only cards. Artwork and Apple links in
//     the artifact are ignored at render time.
// Flipping the flag and restarting the service is the entire deploy change.
export const ARTWORK_MODE = process.env.ARTWORK_MODE === 'text' ? 'text' : 'tmdb';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** Builds the app server. Loading the index is synchronous and cheap at this catalog size. */
export function createApp({ artifactPath = ARTIFACT_PATH, dbPath = DB_PATH } = {}) {
  const index = loadIndex({ artifactPath, dbPath });

  async function serveStatic(res, urlPath) {
    const relative = urlPath === '/' ? '/index.html' : urlPath;
    const resolved = path.normalize(path.join(PUBLIC_DIR, relative));
    if (!resolved.startsWith(PUBLIC_DIR)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      const fileStat = await stat(resolved);
      if (fileStat.isDirectory()) throw new Error('directory');
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
      return;
    }
    const body = await readFile(resolved);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(resolved)] || 'application/octet-stream' });
    res.end(body);
  }

  function handleSearch(res, url) {
    const q = url.searchParams.get('q') || '';
    const ageBand = url.searchParams.get('age') || undefined;
    const vibe = url.searchParams.get('vibe') || undefined;
    const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 50);
    if (!q.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'give the search a situation or a feeling' }));
      return;
    }
    const results = index.search(q, { ageBand, vibe, limit });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: index.version, storyCount: index.storyCount, artworkMode: ARTWORK_MODE, count: results.length, results }));
  }

  return createHttpServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/search') {
      handleSearch(res, url);
      return;
    }
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, version: index.version, storyCount: index.storyCount, artworkMode: ARTWORK_MODE }));
      return;
    }
    serveStatic(res, url.pathname).catch((err) => {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end('server error');
    });
  });
}

/** Entry point: node src/server.mjs */
export function main() {
  const port = Number(process.env.PORT) || 3000;
  const app = createApp();
  app.listen(port, () => {
    console.log(`show-finder listening on http://localhost:${port}`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
