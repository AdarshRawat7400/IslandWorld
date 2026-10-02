# Android release validation — 2026-10-02

## Artifact

- Package: `com.islandworld.game`; version `1.0.0-beta.1`, code `1`.
- Signed, non-debuggable release APK; minimum SDK 29, target SDK 36.
- Size: 146,379,246 bytes.
- SHA256: `c47fa979e0626e5a0828a090b9224f137c86ce566295a21449033b5bd866bdda`.
- Signing certificate SHA256: `2c6435897485f25de575e0b297ebc1327ebf5390e9c860b22417c1e9da8609f8`.

`tools/android/verify-apk.ps1` verified the signature, identity, SDK levels,
permissions, secure local origin, preserved Chromium keyboard input, and every
one of the **219 bundled production web assets** against `dist/` by SHA256.
The APK excludes private signing files, local-only meme recordings, nested APKs,
and browser-only download metadata. The exported APK and private keys are not in
Git or the Firebase site.

## Automated checks

- **357 JavaScript tests passed**, zero failures/skips.
- **3 native permission unit tests passed**: local audio capture accepted,
  remote origins and unsupported capture resources rejected.
- Production Vite build and signed Android release assembly passed.
- Full npm dependency audit: zero reported vulnerabilities at validation time.
- `git diff --check` passed.

## Actual signed APK on a physical phone

Device: **Motorola edge 60 fusion**, Android **16**, Android System WebView
**153.0.8010.36**. Tests installed the actual non-debuggable release APK. A
separate instrumentation package was signed with the matching release
certificate, ran **2 passing tests**, then was removed. The game remains
installed; production/debug app signing was not weakened for testing.

Verified against the real bundled island and WebGL2 renderer:

- Landscape view, secure `https://localhost` origin, assets, native App plugin,
  touch HUD, and no graphics-context recovery error.
- Three simultaneously **injected Android touchpoints on the physical phone**:
  movement joystick, look-region drag, and sprint/aim/fire/reload. Moving the
  player changed its displayed map position. FIRE and RELOAD succeeded while
  the joystick/look contacts remained held in the injected event stream;
  releasing contacts preserved latched AIM. Continued movement/look after
  releasing FIRE was not separately measured.
- Revolver aiming and firing, ammunition depletion, reload and persistent AIM,
  equipment wheel, hunting-rifle selection, and returning to the revolver.
- Pause/resume, map opening, native App Back dispatcher menu/resume/map callbacks,
  activity background/foreground pause, and explicit Resume.
- Real Android `InputConnection.commitText` entered `O'Neil QA` and a room code
  without losing the apostrophe or characters.
- The APK joined an **Explore** room created by an independent Firebase browser
  identity. Its live roster showed both `Android QA` and `Browser QA`, Connected,
  and the same code. It then left cleanly. The browser remained connected.

The live Render server accepts the APK's exact `https://localhost` origin.
Browser-only localhost preview origins are not added to the production allowlist.
Existing server regression tests cover Explore/PvP rules, ammunition, protection,
health/respawn, room limits and voice identity authorization.

## Performance sample

At South Landing in clear/noon conditions, the actual phone's 60-frame sample
measured **24.8 FPS average**, **29.9 FPS median**, and a **100 ms worst frame**.
The canvas was 819 × 368, scaled into a 964 × 433 CSS-pixel viewport. This is one
short scene sample, not a whole-island or all-weather benchmark. Frame rate
varies; this release does not promise 60 FPS on phones.

The APK starts with the conservative mobile graphics profile. Desktop and mobile
browser profile selection remains unchanged. The multitouch action fix applies
to both the APK and mobile browser.

## Remaining manual checks

- Physical Android predictive Back gestures, Home/screen-lock sequences and
  prolonged background suspension. Automated Back checks exercise the real
  native dispatcher, not a human system gesture.
- Microphone denial/approval and actual two-way LiveKit audio through the phone
  speaker, wired/Bluetooth headsets, and background microphone routing.
- Wi-Fi/cellular handoffs, different-network cross-play, offline cold launch,
  sustained storm/driving/drone sessions, and more Android models/WebView builds.

Evidence is saved locally under `work/android-release/multitouch-signed-device-test/`
including signed verification reports, instrumentation output, frame timing, IME
and multitouch reports, and gameplay/shared-room screenshots. These generated
files are ignored by Git. Build and repeat-test instructions are in [ANDROID.md](ANDROID.md).
