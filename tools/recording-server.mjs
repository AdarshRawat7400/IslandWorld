// Local-only receiver for MediaRecorder chunks from the development build.
// It writes each chunk immediately, avoiding a 10-minute recording in browser RAM.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function option(name, fallback) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
}
const port = Number(option('--port', '48173'));
const outputDir = path.resolve(option('--output-dir', path.join(projectRoot, 'VideoExports', 'raw')));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid --port');
await mkdir(outputDir, { recursive: true });

const sessions = new Map();
const allowedOrigin = (origin) => !origin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
const json = (response, status, value) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
};
async function body(request, maxBytes = 20 * 1024 * 1024) {
  const pieces = [];
  let size = 0;
  for await (const piece of request) {
    size += piece.length;
    if (size > maxBytes) throw new Error(`Request exceeds ${maxBytes} bytes`);
    pieces.push(piece);
  }
  return Buffer.concat(pieces, size);
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (!allowedOrigin(origin)) return json(response, 403, { error: 'Origin is not a local development page' });
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Vary', 'Origin');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json(response, 200, { ok: true, outputDir });
    }
    if (request.method === 'POST' && url.pathname === '/session') {
      const config = JSON.parse((await body(request, 1024)).toString('utf8'));
      const name = String(config.name ?? 'islandworld-capture');
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name)) {
        return json(response, 400, { error: 'Name must contain only letters, numbers, _ or -' });
      }
      const id = randomUUID();
      const format = config.format === 'h264' ? 'h264'
        : String(config.mimeType || '').startsWith('video/mp4') ? 'mp4' : 'webm';
      const extension = format;
      const filename = `${name}-${id}.${extension}`;
      const filenameFull = path.join(outputDir, filename);
      const handle = await open(filenameFull, 'wx');
      sessions.set(id, { handle, filenameFull, format, bytes: 0, chunks: 0,
        queue: Promise.resolve(), createdAt: new Date().toISOString() });
      return json(response, 201, { id, filenameFull });
    }
    const chunkMatch = /^\/session\/([a-f0-9-]+)\/(chunk|finish)$/.exec(url.pathname);
    if (request.method === 'POST' && chunkMatch) {
      const [, id, action] = chunkMatch;
      const session = sessions.get(id);
      if (!session) return json(response, 404, { error: 'Unknown recording session' });
      if (action === 'chunk') {
        const bytes = await body(request);
        if (!bytes.length) return json(response, 400, { error: 'Empty recording chunk' });
        session.queue = session.queue.then(async () => {
          await session.handle.writeFile(bytes);
          session.bytes += bytes.length;
          session.chunks += 1;
        });
        await session.queue;
        return json(response, 200, { bytes: session.bytes, chunks: session.chunks });
      }
      const finishBody = await body(request, 2048);
      const clientMetadata = finishBody.length ? JSON.parse(finishBody.toString('utf8')) : {};
      await session.queue;
      await session.handle.sync();
      await session.handle.close();
      sessions.delete(id);
      const result = { filenameFull: session.filenameFull, format: session.format,
        bytes: session.bytes, chunks: session.chunks,
        createdAt: session.createdAt, completedAt: new Date().toISOString(),
        ...clientMetadata };
      await writeFile(`${session.filenameFull}.json`, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      return json(response, 200, result);
    }
    return json(response, 404, { error: 'Unknown endpoint' });
  } catch (error) {
    return json(response, 500, { error: error.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`IslandWorld capture receiver: http://127.0.0.1:${port}\n`);
  process.stdout.write(`Raw recordings: ${outputDir}\n`);
});
