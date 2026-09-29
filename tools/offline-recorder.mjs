// Deterministic capture for a browser that renders fewer than 30 frames per
// wall-clock second. The caller advances the world to i / fps, renders once,
// then calls captureFrame(i). Encoded H.264 frames carry fixed timestamps.
const DEFAULT_SERVER = 'http://127.0.0.1:48173';

async function checked(response) {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Capture receiver HTTP ${response.status}`);
  return result;
}

function configCandidates(width, height, fps, bitrate) {
  const common = { width, height, framerate: fps, bitrate,
    latencyMode: 'realtime', hardwareAcceleration: 'prefer-hardware',
    avc: { format: 'annexb' } };
  return [
    { codec: 'avc1.640028', ...common }, // H.264 High, level 4.0
    { codec: 'avc1.42E028', ...common }, // Constrained Baseline fallback
  ];
}

/**
 * Start hardware-assisted, frame-stepped capture of the real game canvas.
 * Unlike MediaRecorder, elapsed wall time does not determine video duration.
 */
export async function startOfflineCanvasRecording({
  canvas = document.querySelector('#game canvas'),
  name = 'islandworld-offline-master',
  serverUrl = DEFAULT_SERVER,
  fps = 30,
  bitrate = 16_000_000,
} = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('IslandWorld canvas not found');
  if (typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function') {
    throw new Error('WebCodecs VideoEncoder and VideoFrame are required');
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new Error('Invalid fps');
  const width = canvas.width;
  const height = canvas.height;
  if (width !== 1920 || height !== 1080) {
    throw new Error(`Expected a 1920x1080 canvas, got ${width}x${height}`);
  }
  let config = null;
  for (const candidate of configCandidates(width, height, fps, bitrate)) {
    const support = await VideoEncoder.isConfigSupported(candidate);
    if (support.supported) { config = support.config; break; }
  }
  if (!config) throw new Error('Chrome cannot encode H.264 Annex B using WebCodecs');
  document.documentElement.dataset.islandOfflineCodec = config.codec;
  const session = await checked(await fetch(`${serverUrl}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, format: 'h264', fps, width, height, codec: config.codec }),
  }));

  let uploadQueue = Promise.resolve();
  let uploadError = null;
  let emittedChunks = 0;
  let emittedBytes = 0;
  let expectedIndex = 0;
  const encoder = new VideoEncoder({
    output(chunk) {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      emittedChunks += 1;
      emittedBytes += bytes.length;
      uploadQueue = uploadQueue.then(async () => {
        const response = await fetch(`${serverUrl}/session/${session.id}/chunk`, {
          method: 'POST', body: bytes,
        });
        await checked(response);
      }).catch((error) => { uploadError = error; });
    },
    error(error) { uploadError = error; },
  });
  try { encoder.configure(config); } catch (error) {
    throw new Error(`WebCodecs configuration failed: ${error.message}`);
  }

  async function captureFrame(index) {
    if (!Number.isInteger(index) || index !== expectedIndex) {
      throw new Error(`Expected frame index ${expectedIndex}, got ${index}`);
    }
    if (uploadError) throw uploadError;
    const microseconds = Math.round(index * 1_000_000 / fps);
    const nextMicroseconds = Math.round((index + 1) * 1_000_000 / fps);
    // Create the snapshot before yielding; the next rAF may repaint the canvas.
    const frame = new VideoFrame(canvas, {
      timestamp: microseconds, duration: nextMicroseconds - microseconds,
    });
    try {
      while (encoder.encodeQueueSize > 3) {
        await new Promise((resolve) => setTimeout(resolve, 8));
        if (uploadError) throw uploadError;
      }
      encoder.encode(frame, { keyFrame: index % (fps * 2) === 0 });
      expectedIndex += 1;
    } finally { frame.close(); }
    // Bound pending network data even if the renderer becomes faster than disk.
    if (index % 30 === 29) await uploadQueue;
    document.documentElement.dataset.islandOfflineFrames = String(expectedIndex);
    return expectedIndex;
  }

  async function finish() {
    if (expectedIndex === 0) throw new Error('No frames were captured');
    await encoder.flush();
    encoder.close();
    await uploadQueue;
    if (uploadError) throw uploadError;
    const result = await checked(await fetch(`${serverUrl}/session/${session.id}/finish`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames: expectedIndex, fps, width, height,
        codec: config.codec, emittedChunks, emittedBytes,
        durationSeconds: expectedIndex / fps }),
    }));
    if (result.chunks !== emittedChunks || result.bytes !== emittedBytes) {
      throw new Error('Capture receiver did not preserve every encoded chunk');
    }
    return result;
  }

  return { captureFrame, finish, filenameFull: session.filenameFull,
    get frames() { return expectedIndex; }, fps, width, height, codec: config.codec };
}
