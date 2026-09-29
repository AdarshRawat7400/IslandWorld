// Replace the end of a deterministic IslandWorld H.264 recording without
// re-encoding any retained frame. Each offline segment starts at an IDR frame.
import { spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, readdirSync } from 'node:fs';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';

const args = process.argv.slice(2);
function option(name, fallback = null) {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1];
}
const head = path.resolve(option('--head') || '');
const tail = path.resolve(option('--tail') || '');
const output = path.resolve(option('--output') || '');
const atSeconds = Number(option('--at'));
const expectTotalArg = option('--expect-total');
const expectTotal = expectTotalArg === null ? null : Number(expectTotalArg);
if (!args.includes('--head') || !args.includes('--tail') || !args.includes('--output')
    || !Number.isFinite(atSeconds) || atSeconds <= 0
    || ![head, tail, output].every((file) => path.extname(file).toLowerCase() === '.h264')
    || new Set([head, tail, output].map((file) => file.toLowerCase())).size !== 3) {
  throw new Error('Usage: node tools/splice-raw.mjs --head FULL.h264 '
    + '--tail RECAPTURE.h264 --at 600 --output SPLICED.h264 [--expect-total 660]');
}
if (existsSync(output) || existsSync(`${output}.json`)) {
  throw new Error(`Output already exists: ${output}`);
}
const [headMeta, tailMeta] = await Promise.all([head, tail].map(async (file) => {
  if (!existsSync(file) || !existsSync(`${file}.json`)) {
    throw new Error(`Raw video or sidecar missing: ${file}`);
  }
  return JSON.parse(await readFile(`${file}.json`, 'utf8'));
}));
for (const [label, meta] of [['head', headMeta], ['tail', tailMeta]]) {
  if (meta.format !== 'h264' || meta.width !== 1920 || meta.height !== 1080
      || meta.fps !== 30 || !Number.isInteger(meta.frames) || meta.frames < 1
      || meta.codec !== headMeta.codec) {
    throw new Error(`${label} sidecar is not compatible 1080p/30 H.264`);
  }
}
const prefixFrames = Math.round(atSeconds * headMeta.fps);
if (prefixFrames !== atSeconds * headMeta.fps || prefixFrames >= headMeta.frames) {
  throw new Error('Splice time must be an exact frame boundary inside the head recording');
}
const totalFrames = prefixFrames + tailMeta.frames;
if (expectTotal !== null && Number.isFinite(expectTotal)
    && totalFrames !== expectTotal * headMeta.fps) {
  throw new Error(`Spliced duration would be ${totalFrames / headMeta.fps}s, not ${expectTotal}s`);
}
function locate(binary) {
  const override = option(`--${binary}`);
  if (override) return path.resolve(override);
  const direct = spawnSync(binary, ['-version'], { encoding: 'utf8', windowsHide: true });
  if (direct.status === 0) return binary;
  if (process.platform === 'win32') {
    const packages = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
    if (existsSync(packages)) {
      for (const packageName of readdirSync(packages)) {
        if (!packageName.startsWith('Gyan.FFmpeg_')) continue;
        for (const build of readdirSync(path.join(packages, packageName))) {
          const candidate = path.join(packages, packageName, build, 'bin', `${binary}.exe`);
          if (existsSync(candidate)) return candidate;
        }
      }
    }
  }
  throw new Error(`${binary} not found`);
}
const ffmpeg = locate('ffmpeg');
const ffprobe = locate('ffprobe');
const prefix = `${output}.prefix.partial.h264`;
const partial = `${output}.partial.h264`;
function run(program, params, label) {
  const result = spawnSync(program, params, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`${label}: ${result.stderr || result.error}`);
  return result.stdout;
}
async function appendFile(stream, file) {
  for await (const chunk of createReadStream(file)) {
    if (!stream.write(chunk)) await once(stream, 'drain');
  }
}
try {
  run(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    '-r', String(headMeta.fps), '-i', head, '-frames:v', String(prefixFrames),
    '-map', '0:v:0', '-c:v', 'copy', '-f', 'h264', prefix], 'Extracting exact raw prefix');
  const prefixProbe = JSON.parse(run(ffprobe, ['-v', 'error', '-count_frames',
    '-show_entries', 'stream=nb_read_frames', '-of', 'json', prefix], 'Counting prefix frames'));
  if (Number(prefixProbe.streams?.[0]?.nb_read_frames) !== prefixFrames) {
    throw new Error(`Prefix frame count is not ${prefixFrames}`);
  }
  const stream = createWriteStream(partial, { flags: 'wx' });
  await appendFile(stream, prefix);
  await appendFile(stream, tail);
  stream.end();
  await once(stream, 'finish');
  const probe = JSON.parse(run(ffprobe, ['-v', 'error', '-count_frames',
    '-show_entries', 'stream=codec_name,width,height,nb_read_frames', '-of', 'json', partial],
  'Decoding spliced raw stream'));
  const video = probe.streams?.[0];
  if (video?.codec_name !== 'h264' || video.width !== 1920 || video.height !== 1080
      || Number(video.nb_read_frames) !== totalFrames) {
    throw new Error(`Spliced raw stream failed frame check: ${JSON.stringify(probe)}`);
  }
  const bytes = (await stat(partial)).size;
  await rename(partial, output);
  const sidecar = { filenameFull: output, format: 'h264', bytes,
    frames: totalFrames, fps: headMeta.fps, width: 1920, height: 1080,
    codec: headMeta.codec, durationSeconds: totalFrames / headMeta.fps,
    splice: { atSeconds, prefixFrames, head, tail, tailFrames: tailMeta.frames } };
  await writeFile(`${output}.json`, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');
  process.stdout.write(`Spliced ${prefixFrames} + ${tailMeta.frames} = ${totalFrames} frames: ${output}\n`);
} finally {
  if (existsSync(prefix)) await unlink(prefix);
  if (existsSync(partial)) await unlink(partial);
}
