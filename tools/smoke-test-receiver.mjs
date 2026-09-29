// Exercise the local chunk receiver with an existing short WebM file.
// Usage: node tools/smoke-test-receiver.mjs C:\path\to\sample.webm
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const input = process.argv[2];
if (!input) throw new Error('Pass an existing short WebM file');
const server = process.argv[3] || 'http://127.0.0.1:48173';
const bytes = await readFile(path.resolve(input));
async function request(endpoint, value) {
  const response = await fetch(`${server}${endpoint}`, {
    method: 'POST',
    ...(value ? { body: value,
      headers: value instanceof Buffer ? {} : { 'Content-Type': 'application/json' } } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
const session = await request('/session', JSON.stringify({ name: 'receiver-smoke-test' }));
for (let offset = 0; offset < bytes.length; offset += 512 * 1024) {
  await request(`/session/${session.id}/chunk`, bytes.subarray(offset, offset + 512 * 1024));
}
const result = await request(`/session/${session.id}/finish`);
if (result.bytes !== bytes.length) throw new Error('Receiver byte count mismatch');
process.stdout.write(`${result.filenameFull}\n`);
