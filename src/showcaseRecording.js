import { evaluateShowcase, SHOWCASE_DURATION_SECONDS } from './showcaseTimeline.js';
import { startCanvasRecording } from '../tools/browser-recorder.mjs';
import { startOfflineCanvasRecording } from '../tools/offline-recorder.mjs';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Local capture controls. The panel is outside the WebGL canvas being recorded. */
export function createShowcaseRecording({ canvas, prepare, start, interact }) {
  const params = new URLSearchParams(location.search);
  const seek = clamp(Number(params.get('seek')) || 0, 0, SHOWCASE_DURATION_SECONDS - 1);
  const defaultLength = SHOWCASE_DURATION_SECONDS - seek;
  const duration = clamp(Number(params.get('duration')) || defaultLength, 1, defaultLength);
  const audio = params.get('audio') === 'none' ? 'none' : 'tab';
  const previewOnly = params.get('preview') === '1';
  const offline = params.get('offline') === '1' && !previewOnly;
  const fps = 30;
  const targetFrames = Math.round(duration * fps);
  const panel = document.createElement('aside');
  panel.id = 'showcase-recording-controls';
  panel.setAttribute('aria-label', 'IslandWorld local video capture');
  Object.assign(panel.style, {
    position: 'fixed', right: '16px', top: '16px', zIndex: '100',
    width: 'min(370px, calc(100vw - 32px))', padding: '13px 15px',
    color: '#ecf0e7', background: '#07151ce9', border: '1px solid #dbc89999',
    font: '13px/1.45 system-ui, sans-serif', boxShadow: '0 8px 30px #0008',
  });
  const status = document.createElement('div');
  status.textContent = previewOnly ? 'Ready to preview the current game world.'
    : offline ? `Ready to render ${targetFrames.toLocaleString()} unique 1080p frames at ${fps} fps.`
      : `Ready to record ${duration.toFixed(0)} seconds from the 1920×1080 game canvas.`;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = previewOnly ? 'PLAY SHOWCASE' : offline ? 'RENDER SHOWCASE' : 'RECORD SHOWCASE';
  Object.assign(button.style, {
    display: 'block', width: '100%', marginTop: '9px', padding: '10px 13px',
    border: '1px solid #ddc492', background: '#dfc995', color: '#17242a',
    font: '700 12px system-ui, sans-serif', letterSpacing: '.08em',
  });
  panel.append(status, button);
  document.body.append(panel);

  let startedAt = null;
  let lastSample = null;
  let recording = null;
  let completing = false;
  let interactionDone = false;
  let frameIndex = 0;
  let frameBusy = false;

  async function finish() {
    if (completing) return;
    completing = true;
    if (previewOnly) {
      status.textContent = 'Showcase preview finished.';
      return;
    }
    status.textContent = 'Finalizing the recording on this computer…';
    try {
      const output = offline ? await recording.finish() : await recording.stop();
      status.textContent = `Saved raw recording: ${output.filenameFull}`;
      console.info('IslandWorld showcase recording complete', output);
      window.__ISLAND_WORLD_SHOWCASE_RESULT__ = output;
    } catch (error) {
      status.textContent = `Recording failed to finalize: ${error.message}`;
      console.error(error);
    }
  }

  button.addEventListener('click', async () => {
    if (startedAt !== null || button.disabled) return;
    button.disabled = true;
    button.textContent = 'PREPARING…';
    try {
      const first = evaluateShowcase(seek);
      prepare(first);
      if (offline) {
        status.textContent = 'Preparing the H.264 frame encoder…';
        recording = await startOfflineCanvasRecording({ canvas,
          name: seek ? `islandworld-shot-${Math.round(seek)}` : 'islandworld-offline-showcase', fps });
      } else if (!previewOnly) {
        status.textContent = audio === 'tab'
          ? 'Select this IslandWorld tab and enable “Share tab audio”.'
          : 'Starting silent canvas recording; audio can be mixed from bundled CC0 tracks.';
        recording = await startCanvasRecording({ canvas, name: seek ? 'islandworld-shot' : 'islandworld-showcase',
          audio, videoBitsPerSecond: 14_000_000 });
      }
      start();
      startedAt = performance.now();
      button.textContent = previewOnly ? 'PLAYING' : offline ? 'RENDERING' : 'RECORDING';
      status.textContent = '00:00 / ' + new Date(duration * 1000).toISOString().slice(14, 19);
    } catch (error) {
      button.disabled = false;
      button.textContent = previewOnly ? 'RETRY PREVIEW' : 'RETRY RECORDING';
      status.textContent = `Capture could not start: ${error.message}`;
      console.error(error);
    }
  });

  function tick(now) {
    if (startedAt === null || completing) return lastSample;
    const localSeconds = offline ? frameIndex / fps
      : clamp((now - startedAt) / 1000, 0, duration);
    const seconds = Math.min(seek + localSeconds, SHOWCASE_DURATION_SECONDS);
    const sample = evaluateShowcase(seconds);
    lastSample = sample;
    if (!interactionDone && sample.interaction === 'dockhand' && localSeconds > 0.7) {
      interactionDone = true;
      interact();
    }
    if (offline ? frameIndex % fps === 0
      : Math.floor(localSeconds) !== Math.floor(localSeconds - 0.05)) {
      const clock = new Date(localSeconds * 1000).toISOString().slice(14, 19);
      status.textContent = `${clock} / ${new Date(duration * 1000).toISOString().slice(14, 19)}`
        + ` · ${sample.label}${offline ? ` · ${frameIndex}/${targetFrames} frames` : ''}`;
    }
    if (!offline && localSeconds >= duration) void finish();
    return sample;
  }

  async function afterRender() {
    if (!offline || startedAt === null || completing || frameBusy) return;
    frameBusy = true;
    try {
      await recording.captureFrame(frameIndex);
      frameIndex += 1;
      if (frameIndex >= targetFrames) await finish();
    } catch (error) {
      completing = true;
      status.textContent = `Frame capture failed at ${frameIndex}: ${error.message}`;
      console.error(error);
    } finally { frameBusy = false; }
  }

  return { tick, afterRender,
    get active() { return startedAt !== null && !completing; },
    get offlineActive() { return offline && startedAt !== null && !completing; },
    get offlineBusy() { return offline && frameBusy; },
    get frameIndex() { return frameIndex; },
    get sample() { return lastSample; } };
}
