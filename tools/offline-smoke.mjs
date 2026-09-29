import { startOfflineCanvasRecording } from './offline-recorder.mjs';

const button = document.querySelector('#record');
const status = document.querySelector('#status');
const canvas = document.querySelector('#test-canvas');
const context = canvas.getContext('2d');
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const recording = await startOfflineCanvasRecording({ canvas, name: 'offline-encoder-smoke' });
    for (let index = 0; index < 60; index += 1) {
      context.fillStyle = `hsl(${index * 6},45%,21%)`;
      context.fillRect(0, 0, 1920, 1080);
      context.fillStyle = '#e7e9e8';
      context.font = 'bold 105px Georgia';
      context.fillText(`FRAME ${String(index).padStart(2, '0')}`, 110, 205);
      context.fillStyle = '#d9ae70';
      context.fillRect(80 + index * 28, 470, 125, 310);
      await recording.captureFrame(index);
      if (index % 10 === 9) status.textContent = `Captured ${index + 1}/60 frames`;
    }
    const result = await recording.finish();
    status.textContent = `Saved ${result.frames} frames: ${result.filenameFull}`;
  } catch (error) {
    status.textContent = `Failed: ${error.message}`;
    button.disabled = false;
    console.error(error);
  }
});
