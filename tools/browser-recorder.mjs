// Import this module from an IslandWorld development page after the game loads.
// The caller should run startCanvasRecording() from a click so Chrome can ask
// for tab audio. Select the IslandWorld tab and enable "Share tab audio".
const DEFAULT_SERVER = 'http://127.0.0.1:48173';
const CODEC_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8',
  'video/webm;codecs=vp9',
];
if (typeof document !== 'undefined' && new URLSearchParams(location.search).has('capture')) {
  document.documentElement.dataset.islandRecorderCodecs = JSON.stringify(
    CODEC_CANDIDATES.map((mime) => [mime, typeof MediaRecorder === 'function'
      && MediaRecorder.isTypeSupported(mime)]));
}

function supportedMime(audio) {
  const codecs = audio
    ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9,opus', 'video/webm']
    : ['video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp8',
      'video/webm;codecs=vp9', 'video/webm'];
  return codecs.find((mime) => MediaRecorder.isTypeSupported(mime));
}

async function checked(response) {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Capture receiver: HTTP ${response.status}`);
  return value;
}

/**
 * Capture the actual WebGL canvas, optionally with the game's tab audio.
 * Call directly from a click handler if audio is 'tab'; browser sharing requires
 * a user gesture. The returned object has stop() and session information.
 */
export async function startCanvasRecording({
  canvas = document.querySelector('#game canvas'),
  name = 'islandworld-capture',
  serverUrl = DEFAULT_SERVER,
  fps = 30,
  videoBitsPerSecond = 14_000_000,
  audio = 'tab',
  audioStream = null,
} = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('IslandWorld canvas not found');
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new Error('fps must be 1-60');
  if (typeof MediaRecorder !== 'function' || !canvas.captureStream) {
    throw new Error('This browser does not support canvas MediaRecorder capture');
  }
  if (audio !== 'tab' && audio !== 'none') throw new Error('audio must be tab or none');
  const gl = canvas.getContext('webgl2');
  const rendererInfo = gl?.getExtension('WEBGL_debug_renderer_info');
  document.documentElement.dataset.islandCaptureGpu = rendererInfo
    ? String(gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)) : 'unavailable';
  document.documentElement.dataset.islandCaptureVisibility = document.visibilityState;
  document.documentElement.dataset.islandCaptureFocused = String(document.hasFocus());

  // Invoke getDisplayMedia before any await to retain the click's user activation.
  const tabPromise = audio === 'tab' && !audioStream
    ? navigator.mediaDevices.getDisplayMedia({ video: true, audio: true,
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' })
    : null;
  const sharedTab = tabPromise ? await tabPromise : null;
  const audioTracks = audioStream?.getAudioTracks?.() ?? sharedTab?.getAudioTracks() ?? [];
  if (audio === 'tab' && !audioTracks.length) {
    sharedTab?.getTracks().forEach((track) => track.stop());
    throw new Error('No tab audio track. Select the IslandWorld tab and enable Share tab audio.');
  }

  const canvasStream = canvas.captureStream(fps);
  const stream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
  const mimeType = supportedMime(audioTracks.length > 0);
  if (!mimeType) throw new Error('No WebM MediaRecorder codec available');
  let session;
  try {
    session = await checked(await fetch(`${serverUrl}/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType }),
    }));
  } catch (error) {
    canvasStream.getTracks().forEach((track) => track.stop());
    sharedTab?.getTracks().forEach((track) => track.stop());
    throw error;
  }

  let upload = Promise.resolve();
  let uploadFailure = null;
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond,
    audioBitsPerSecond: 192_000 });
  recorder.addEventListener('dataavailable', (event) => {
    if (!event.data?.size) return;
    upload = upload.then(async () => {
      const result = await fetch(`${serverUrl}/session/${session.id}/chunk`, {
        method: 'POST', body: event.data,
      });
      await checked(result);
    }).catch((error) => { uploadFailure = error; });
  });
  recorder.start(1000);
  const startedAt = performance.now();
  let animationFrames = 0;
  let frameWatch = 0;
  const countFrame = () => { animationFrames += 1; frameWatch = requestAnimationFrame(countFrame); };
  frameWatch = requestAnimationFrame(countFrame);
  async function stop() {
    if (recorder.state === 'inactive') throw new Error('Recording already stopped');
    const stopped = new Promise((resolve, reject) => {
      recorder.addEventListener('stop', resolve, { once: true });
      recorder.addEventListener('error', (event) => reject(event.error), { once: true });
    });
    recorder.stop();
    await stopped;
    cancelAnimationFrame(frameWatch);
    await upload;
    canvasStream.getTracks().forEach((track) => track.stop());
    sharedTab?.getTracks().forEach((track) => track.stop());
    if (uploadFailure) throw uploadFailure;
    const result = await checked(await fetch(`${serverUrl}/session/${session.id}/finish`, {
      method: 'POST',
    }));
    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    const renderFps = animationFrames / Math.max(elapsedSeconds, 0.001);
    document.documentElement.dataset.islandCaptureRenderFps = renderFps.toFixed(2);
    document.documentElement.dataset.islandCaptureFocusedAtStop = String(document.hasFocus());
    return { ...result, elapsedSeconds, animationFrames, renderFps,
      width: canvas.width, height: canvas.height, mimeType };
  }
  return { stop, id: session.id, filenameFull: session.filenameFull,
    width: canvas.width, height: canvas.height, mimeType, startedAt };
}
