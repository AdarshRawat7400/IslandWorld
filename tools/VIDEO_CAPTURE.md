# IslandWorld cinematic capture

The capture-only page renders the current game world at 1920 × 1080. It steps
the showcase timeline once per frame and feeds WebGL frames to the browser's
WebCodecs H.264 encoder. The video has 30 distinct frames per second even if
rendering takes longer than real time. A local receiver immediately writes the
encoded H.264 chunks to disk, avoiding a large browser Blob. It binds only to
`127.0.0.1`. The process does not use or change OBS settings.

The film timeline is **11:00 total**: a 30-second teaser followed by a 10:30
showcase. Its first 30 seconds are also exported as a separate file.

## Capture

From the IslandWorld project directory, use separate terminals:

```powershell
node tools/recording-server.mjs --output-dir VideoExports/raw
npm run dev -- --host 127.0.0.1 --port 5176 --strictPort
```

Open this URL in a foreground Chrome tab and wait for assets to load:

```text
http://127.0.0.1:5176/?capture=showcase&offline=1&audio=none
```

Click **RENDER SHOWCASE** once. The page reports progress through 19,800
frames. After it reports `Saved raw recording`, copy the absolute `.h264` path.
The receiver writes an adjacent `.h264.json` sidecar with dimensions, frame
count, frame rate, and completion timestamps. Keep both files. Browser and
receiver must stay open until completion; avoid source edits that trigger a
Vite reload during capture.

For a short validation, append `&seek=50&duration=2`. It should produce exactly
60 encoded frames, 1920 × 1080, with `fps: 30` in the sidecar. The `seek`
parameter chooses a position in the existing showcase; `duration` chooses a
sample length. The final capture uses no `seek` or `duration` override.

## Encode both H.264 MP4 deliverables

FFmpeg is installed on this machine through the `Gyan.FFmpeg` winget package.
The script finds it on `PATH` or in the winget package directory. Install on
another Windows computer if needed:

```powershell
winget install --id Gyan.FFmpeg --exact --accept-source-agreements --accept-package-agreements
```

After the raw recording passes visual QA, run:

```powershell
node tools/encode-video.mjs --input "C:\path\to\islandworld-offline-showcase-ID.h264" --soundtrack
```

`--soundtrack` mixes the project's distributable CC0 piano, wind, rain, and
ocean audio at restrained levels because offline WebCodecs video is silent.
The encoder adds the teaser closing text, a brief dockhand caption, and the
final IslandWorld title. It outputs:

- `VideoExports/IslandWorld_full_11m_1080p_H264.mp4`
- `VideoExports/IslandWorld_teaser_30s_1080p_H264.mp4`

The script checks raw frame count and source resolution, then verifies both
exports as 1920 × 1080 H.264 with AAC audio and the requested durations. It
uses NVIDIA NVENC by default; append `--encoder x264` for a CPU fallback. It
rejects upscaled sources by default. Source asset attributions are listed in
`public/assets/music/SOURCES.md` and `public/assets/audio/SOURCES.md`.

For a short encoder smoke test, pass a two-second `.h264` recording together
with `--duration 2 --teaser-duration 1 --soundtrack --output-dir "$env:TEMP\IslandWorldEncoderTest"`.
That test output stays outside the deliverable directory.

## Review

Verify the signature orbit travels around the island and returns to its
starting bearing without a cut. Spot-check the weather transitions, three
locked timelapses, day-to-night lighting, Southwest Warden lighthouse shot,
ground-level wildlife, closing title, and audio levels. A full decoder pass:

```powershell
ffmpeg -v error -i "VideoExports\IslandWorld_full_11m_1080p_H264.mp4" -f null NUL
```
