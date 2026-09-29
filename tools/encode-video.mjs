// Transcode a finished IslandWorld recording to deliverable 1080p H.264 MP4s.
// The source must cover 11:00 with its teaser in the first 30 s.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function option(name, fallback = null) {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1];
}
const input = option('--input');
if (!input) {
  throw new Error('Usage: node tools/encode-video.mjs --input CAPTURE.h264 '
    + '[--output-dir VideoExports] [--duration 660] [--teaser-duration 30] '
    + '[--soundtrack]');
}
const inputPath = path.resolve(input);
if (!existsSync(inputPath)) throw new Error(`Input missing: ${inputPath}`);
const outputDir = path.resolve(option('--output-dir', path.join(projectRoot, 'VideoExports')));
const duration = Number(option('--duration', '660'));
const teaserDuration = Number(option('--teaser-duration', '30'));
if (!(duration > 0 && teaserDuration > 0 && teaserDuration < duration)) {
  throw new Error('Invalid duration or teaser duration');
}
const allowSilent = args.includes('--allow-silent');
const soundtrack = args.includes('--soundtrack');
const allowUpscale = args.includes('--allow-upscale');
const requestedEncoder = option('--encoder', 'nvenc');
if (!['nvenc', 'x264'].includes(requestedEncoder)) throw new Error('--encoder must be nvenc or x264');

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
        const packageRoot = path.join(packages, packageName);
        for (const build of readdirSync(packageRoot)) {
          const candidate = path.join(packageRoot, build, 'bin', `${binary}.exe`);
          if (existsSync(candidate)) return candidate;
        }
      }
    }
  }
  throw new Error(`${binary} not found. Install Gyan.FFmpeg with winget or pass --${binary} PATH`);
}
const ffmpeg = locate('ffmpeg');
const ffprobe = locate('ffprobe');

function probe(file) {
  const command = spawnSync(ffprobe, ['-v', 'error', '-show_entries',
    'format=duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate',
    '-of', 'json', file], { encoding: 'utf8', windowsHide: true });
  if (command.status !== 0) throw new Error(`ffprobe failed for ${file}: ${command.stderr}`);
  return JSON.parse(command.stdout);
}

function run(command, parameters, label, cwd = projectRoot) {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${label}\n`);
    const child = spawn(command, parameters, { stdio: 'inherit', windowsHide: true, cwd });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`${label} failed (${code})`)));
  });
}

const elementaryH264 = path.extname(inputPath).toLowerCase() === '.h264';
const metadata = elementaryH264
  ? JSON.parse(await readFile(`${inputPath}.json`, 'utf8')) : null;
if (elementaryH264 && (!Number.isInteger(metadata.frames) || metadata.frames < 1
    || !Number.isFinite(metadata.fps) || metadata.fps <= 0
    || metadata.width !== 1920 || metadata.height !== 1080)) {
  throw new Error('Raw H.264 sidecar is missing valid 1920x1080 frame metadata');
}
const source = probe(inputPath);
const video = source.streams.find((stream) => stream.codec_type === 'video');
const audio = source.streams.find((stream) => stream.codec_type === 'audio');
const sourceSeconds = elementaryH264 ? metadata.frames / metadata.fps
  : Number(source.format.duration);
if (!video || !Number.isFinite(sourceSeconds)) throw new Error('Source has no valid video/duration');
if (sourceSeconds < duration - 0.08) {
  throw new Error(`Source is ${sourceSeconds.toFixed(3)} s, short of requested ${duration} s`);
}
if ((video.width < 1920 || video.height < 1080) && !allowUpscale) {
  throw new Error(`Source is ${video.width}x${video.height}; capture actual 1920x1080 `
    + 'or explicitly pass --allow-upscale');
}
if (!audio && !allowSilent && !soundtrack) {
  throw new Error('Source has no audio. Capture tab audio or pass --soundtrack '
    + 'to mix the bundled CC0 piano and ambience.');
}
await mkdir(outputDir, { recursive: true });

function assClock(seconds) {
  const hundredths = Math.round(seconds * 100);
  const h = Math.floor(hundredths / 360000);
  const m = Math.floor(hundredths / 6000) % 60;
  const s = Math.floor(hundredths / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`;
}
const overlayName = '.IslandWorld_titles.ass';
const overlays = [
  '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080',
  'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Title,Georgia,72,&H00F0EEE8,&H00F0EEE8,&H90071319,&H00000000,-1,0,0,0,100,100,4,0,1,3,2,2,100,100,135,1',
  'Style: Tagline,Georgia,40,&H00F0EEE8,&H00F0EEE8,&H90071319,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,100,100,75,1',
  'Style: Caption,Arial,42,&H00F0EEE8,&H00F0EEE8,&H90071319,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,100,100,90,1',
  '', '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  `Dialogue: 0,${assClock(27.5)},${assClock(30)},Title,,0,0,0,,{\\fad(350,250)}ISLAND WORLD`,
  `Dialogue: 0,${assClock(27.5)},${assClock(30)},Tagline,,0,0,0,,{\\fad(350,250)}— One island. Never the same sky.`,
  `Dialogue: 0,${assClock(579)},${assClock(584)},Caption,,0,0,0,,{\\fad(200,200)}Tamsin · The south cove changes with every tide.`,
  `Dialogue: 0,${assClock(655)},${assClock(660)},Title,,0,0,0,,{\\fad(450,500)}ISLAND WORLD`,
  '',
].join('\n');
await writeFile(path.join(outputDir, overlayName), overlays, 'utf8');

const videoCodec = requestedEncoder === 'nvenc'
  ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '21', '-b:v', '0',
    '-maxrate', '18M', '-bufsize', '36M']
  : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '19'];
const outputVideo = ['-vf', `fps=30,scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p,ass=${overlayName}`,
  '-r', '30', ...videoCodec, '-g', '60', '-profile:v', 'high', '-pix_fmt', 'yuv420p'];
const soundtrackFiles = [
  path.join(projectRoot, 'public', 'assets', 'music', 'forget-me-not-loop.ogg'),
  path.join(projectRoot, 'public', 'assets', 'audio', 'wind.ogg'),
  path.join(projectRoot, 'public', 'assets', 'audio', 'rain.ogg'),
  path.join(projectRoot, 'public', 'assets', 'audio', 'ocean-wave-1.flac'),
];
if (soundtrack) {
  for (const file of soundtrackFiles) {
    if (!existsSync(file)) throw new Error(`Bundled soundtrack file missing: ${file}`);
  }
}
const inputArgs = elementaryH264
  ? ['-fflags', '+genpts', '-r', String(metadata.fps), '-i', inputPath]
  : ['-i', inputPath];
if (soundtrack) {
  for (const file of soundtrackFiles) inputArgs.push('-stream_loop', '-1', '-i', file);
}
// Two-second ramps keep ambience from popping at shot boundaries. These cues
// follow the captured weather chapters; the clear orbit and day/night passage
// stay quiet while the stormy distant-island ending gets its rain and wind.
const envelope = (start, end, ramp = 2) =>
  `(clip((t-${start})/${ramp},0,1)*clip((${end}-t)/${ramp},0,1))`;
const rainWindows = [
  [8, 27, 0.05], [179, 261, 0.07],
  [281, 306, 0.065], [321, 346, 0.065], [361, 386, 0.065],
  [398, 435, 0.07], [547, 556, 0.05], [562, 578, 0.07],
  [619, 660, 0.08],
];
const windWindows = [
  [8, 27, 0.03], [211, 252, 0.045],
  [286, 298, 0.03], [326, 338, 0.03], [366, 378, 0.03],
  [398, 418, 0.04], [562, 578, 0.035], [619, 660, 0.045],
];
const seaWindows = [
  [0, 8, 0.012], [23, 27, 0.015], [30, 120, 0.012],
  [390, 426, 0.025], [600, 660, 0.015],
];
const dynamicVolume = (base, windows) => `${base}${windows.map(([start, end, gain]) =>
  `+${gain}*${envelope(start, end)}`).join('')}`;
const soundtrackFilter = [
  '[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.14[piano]',
  `[2:a]aformat=sample_rates=48000:channel_layouts=stereo,volume='${dynamicVolume(0.025, windWindows)}':eval=frame[wind]`,
  `[3:a]aformat=sample_rates=48000:channel_layouts=stereo,volume='${dynamicVolume(0.006, rainWindows)}':eval=frame[rain]`,
  `[4:a]aformat=sample_rates=48000:channel_layouts=stereo,volume='${dynamicVolume(0.02, seaWindows)}':eval=frame[sea]`,
  '[piano][wind][rain][sea]amix=inputs=4:duration=longest:normalize=0,alimiter=limit=0.8,loudnorm=I=-23:LRA=11:TP=-2[aout]',
].join(';');
const outputAudio = soundtrack
  ? ['-filter_complex', soundtrackFilter, '-map', '[aout]',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2']
  : audio ? ['-map', '0:a:0', '-af', 'loudnorm=I=-23:LRA=11:TP=-2',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'] : ['-an'];
const master = path.join(outputDir, 'IslandWorld_full_11m_1080p_H264.mp4');
const teaser = path.join(outputDir, 'IslandWorld_teaser_30s_1080p_H264.mp4');
const masterPartial = path.join(outputDir, '.IslandWorld_full.partial.mp4');
const teaserPartial = path.join(outputDir, '.IslandWorld_teaser.partial.mp4');
const common = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'];
await run(ffmpeg, [...common, ...inputArgs, '-t', String(duration), '-map', '0:v:0',
  ...outputVideo, ...outputAudio, '-movflags', '+faststart', masterPartial],
'Encoding 1080p H.264 full film', outputDir);
await rename(masterPartial, master);
await run(ffmpeg, [...common, '-i', master, '-t', String(teaserDuration),
  '-map', '0:v:0', '-vf', 'fps=30,format=yuv420p', '-r', '30', ...videoCodec,
  '-g', '60', '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...(audio || soundtrack
    ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'] : ['-an']),
  '-movflags', '+faststart', teaserPartial],
'Exporting separate 30-second teaser', outputDir);
await rename(teaserPartial, teaser);

for (const [label, file, expected] of [['showcase', master, duration],
  ['teaser', teaser, teaserDuration]]) {
  const result = probe(file);
  const seconds = Number(result.format.duration);
  const picture = result.streams.find((stream) => stream.codec_type === 'video');
  const audioStream = result.streams.find((stream) => stream.codec_type === 'audio');
  if (Math.abs(seconds - expected) > 0.08 || picture?.codec_name !== 'h264'
      || picture.width !== 1920 || picture.height !== 1080
      || ((audio || soundtrack) && audioStream?.codec_name !== 'aac')) {
    throw new Error(`${label} export failed verification: ${JSON.stringify(result)}`);
  }
  process.stdout.write(`${label}: ${file} (${seconds.toFixed(3)} s, ${picture.width}x${picture.height}, `
    + `${picture.codec_name}${audioStream ? ` + ${audioStream.codec_name}` : ''})\n`);
}
