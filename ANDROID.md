# IslandWorld for Android

The Android app packages the same IslandWorld Three.js game used by desktop and
mobile browsers. The APK contains the production world assets and opens them
from a secure local WebView origin, `https://localhost`. It does not load the
Firebase website as a remote wrapper. TheThirdLight is a separate project.

**Browser game:** [Play IslandWorld](https://islandworld-3ccb4.web.app/)

**Android download page:** [IslandWorld for Android](https://islandworld-3ccb4.web.app/android.html)

The download page identifies the current signed APK and its SHA256 checksum.
The APK file is distributed separately through Google Drive. Android installation
requires the normal system installer prompts; downloading does not install it
automatically.

## Device requirements and controls

- Android 10 or newer, with an up-to-date Android System WebView/Chrome.
- A working WebGL2 / OpenGL ES 3 graphics driver. Renderer support depends on
  the device and its current Android System WebView.
- Landscape orientation. The native host hides system bars and allows either
  landscape direction, while keeping controls clear of screen cutouts.
- The same compact touch controls used in the mobile browser: movement stick,
  right-side look drag, SPRINT, POSE, FIRE, persistent AIM, RELOAD, WHEEL, and MORE.
  Driving and drone view retain their existing controls.

Native input capture is disabled so Android's standard keyboard/IME can enter
player names and room codes; normal WebView touch controls remain active.

The APK starts with a conservative graphics profile: an 18,000 grass budget,
density multiplier 4, pixel ratio capped at 0.85, 512px sun shadows, and four
volumetric-cloud raymarch steps. Weather, foliage animation, wildlife, island
geometry, cars, multiplayer and gameplay remain available. Desktop and mobile
browser profile selection is unchanged.

Android memory and CPU-core hints can overestimate the capacity of a phone's GPU,
so an 8GB phone does not automatically receive the expensive mobile-high profile
inside the APK. Packaging does not make the Three.js renderer faster; frame rate
still depends on the phone, driver, Android WebView, weather and camera view.

Android Back closes the equipment wheel or map first, opens the pause menu during
play, and resumes an already paused game when pressed from the menu. Back is
consumed on the title screen; Home and Android's app switcher remain available.
The game holds the screen awake while its activity is visible.

## Offline world, online rooms, and voice

Single-player exploration uses bundled models, textures, sound, weather, and
terrain, and does not require a network after installation. The menu settings are
stored in the app's own WebView storage, independently of the browser game.

Private multiplayer and room voice require internet access. The production APK
uses the Render room server configured by `.env.production`; it can share rooms
with the Firebase browser build. The server allows the app's exact
`https://localhost` origin, and validates gameplay as it does for browser players.
Render Free may take time to wake after inactivity. Server restarts end in-memory
rooms. See [MULTIPLAYER_SERVER.md](MULTIPLAYER_SERVER.md) and
[VOICE_CHAT.md](VOICE_CHAT.md) for the existing room and LiveKit setup.

Voice stays opt-in: join Room Voice, then explicitly enable the microphone.
Android requests microphone permission only when the app asks to capture audio.
The WebView permission handler permits audio capture only for bundled
`https://localhost` content; camera requests, remote origins, and unknown capture
resources are denied. No camera or storage permission is requested.

Backgrounding the app releases held inputs, pauses gameplay, silences local and
incoming voice audio, and disables microphone transmission. Returning to the app
does not automatically resume gameplay or the microphone. Resume the game with a
user gesture, then enable the microphone again if desired. Existing room
reconnection remains responsible for a connection interrupted by Android or a
network change.

## Build requirements

The Android toolchain uses Capacitor 8, Android Gradle Plugin 8.13.0, Gradle
8.14.3, Java 21, and Android SDK 36. Install:

- Node.js 22.12 or newer and npm.
- JDK 21, or the compatible bundled JDK in Android Studio 2025.2.1 or newer.
- Android SDK Platform 36, compatible build tools, and platform tools (`adb`).

Set `JAVA_HOME` to the JDK directory. Configure your SDK path in the ignored
`android/local.properties`, for example:

```properties
sdk.dir=C:/Users/YOUR_USER/AppData/Local/Android/Sdk
```

Use forward slashes in that Java properties path. Keep machine-specific toolchain
paths out of Git. [Capacitor's official setup guide](https://capacitorjs.com/docs/getting-started/environment-setup)
describes the supported environment.

## Local startup and APK builds

From this project directory:

```powershell
npm ci
npm test
npm run dev
```

This starts the existing browser workflow. Android packaging is optional and does
not change the desktop/browser startup commands.

To build an installable development APK and run native unit tests:

```powershell
npm run android:debug
```

To open the native project in Android Studio:

```powershell
npm run android:sync
npm run android:open
```

To create the private release signing key once and build a signed release:

```powershell
npm run android:key
npm run android:release
```

The scripts build the production website, copy it into the Android assets with
Capacitor, assemble the requested variant, run `testDebugUnitTest`, and export:

```text
work/android-release/IslandWorld-debug.apk
work/android-release/IslandWorld-debug.apk.sha256
work/android-release/IslandWorld-release.apk
work/android-release/IslandWorld-release.apk.sha256
```

Only the requested APK variant is produced by each command. Debug builds use
Android's development signing certificate; public distribution should use the
release APK. Downloadable APK files are excluded from the native asset copy to
prevent accidentally embedding another APK inside the app.

## Signing, credentials, and updates

The first release-key command creates an RSA 4096 signing key at:

```text
%LOCALAPPDATA%/IslandWorld/signing/islandworld-release.jks
```

The key and its randomly generated password are private. Gradle reads them from
the ignored `android/signing.properties`; that file and the key have Windows
access restricted to the current user. The script refuses to overwrite existing
signing material. Back up both files privately: future APK updates must use the
same signing key. Losing it prevents an in-place update to installed copies.
Never include the key, password, LiveKit secrets, or signing properties in Git,
Firebase, Drive downloads, or a public release archive.

CI may instead supply these environment variables:

```text
ISLANDWORLD_KEYSTORE_FILE
ISLANDWORLD_KEYSTORE_PASSWORD
ISLANDWORLD_KEY_ALIAS
ISLANDWORLD_KEY_PASSWORD
```

The initial app identity is `com.islandworld.game`, version
`1.0.0-beta.1`, version code `1`, with minimum SDK `29` and target SDK `36`.
For an update, increase `versionCode` and update `versionName` in
`android/app/build.gradle`, rebuild with the same key, replace the public Drive
file/link as needed, and update the download page's version, size, and checksum.
The app does not silently download or install executable updates.

## Device verification

See [ANDROID_VALIDATION.md](ANDROID_VALIDATION.md) for the initial signed release's
actual phone checks, performance sample, and remaining manual checks.

Before publishing a new APK, run the browser tests and native checks, then test
the actual signed APK on an authorized Android device:

```powershell
npm test
npm run android:release
powershell -NoProfile -ExecutionPolicy Bypass -File tools/android/verify-apk.ps1 -ReportPath work/android-release/apk-verification.json
powershell -NoProfile -ExecutionPolicy Bypass -File tools/android/test-device.ps1 -DeviceSerial YOUR_AUTHORIZED_DEVICE_SERIAL
```

The device runner verifies and installs the actual signed release APK, builds a
separate instrumentation APK, signs only that tester with the same private release
key, and exercises the real bundled WebView. It requires an explicitly selected,
authorized ADB device. It saves the test results and device screenshots/reports in
`work/android-release/signed-device-test/`, removes the disposable `.test` package,
and leaves the production game installed. An existing development copy uses a
different certificate and must be explicitly removed before installing the
release; the script preserves an already installed production game. Pass
`-JoinCode YOUR_SIX_CHARACTER_CODE` to check a shared room with an independent
browser identity. For development-only debugging, Gradle's
`connectedDebugAndroidTest` uses the debug target instead. Native unit tests
check that only local audio capture is accepted and that remote origins and
camera requests are denied. The JavaScript tests check lifecycle handling,
background input release, explicit resuming, and the native origin policy.

The APK verifier uses the installed SDK's `apksigner` and `aapt` to validate the
signature, package/version, minimum/target SDK, release debug flag, and microphone
permissions. It compares every bundled production web asset against `dist/` by
SHA256, checks the secure local configuration, and rejects nested APKs, private
credentials, local meme recordings, and browser-only download metadata. It writes
an optional JSON report and the APK's SHA256 sidecar without reading or printing
signing secrets. Supply `-SdkDirectory` if the SDK is not configured in the
environment or `android/local.properties`.

Check these behaviors on a phone:

1. Launch, asset loading, landscape orientation, cutouts, and touch HUD.
2. Walking, looking, sprint, aim/fire/reload, wheel, driving, and drone view.
3. Android Back, Home, screen lock, return/resume, and no held-input movement.
4. Offline single-player launch and visible models/textures/weather/audio.
5. A room shared with an independent browser identity, movement and combat.
6. Voice permission denial and approval, actual two-way audio, microphone toggle,
   and microphone silence after backgrounding.
7. Wi-Fi/mobile-data transitions, room reconnection, and phone GPU/frame stability.

Passing automated checks does not establish performance or voice routing on every
Android device. Record the tested device, Android/WebView versions, release
checksum, and any remaining real-device checks with each release.

## Download hosting without enabling billing

The game and Android download landing page remain on Firebase Hosting. The APK
is shared through Google Drive with public view/download access and a direct
download button. Drive can impose scan, download, or quota confirmation screens;
the button cannot bypass those provider checks.

Firebase Spark blocks APK uploads/hosting for newer projects, and Cloud Storage
for Firebase requires the Blaze plan. This implementation does not upgrade the
project or enable billing. See the official
[Firebase Hosting executable-file restriction](https://firebase.google.com/docs/hosting/faq-and-troubleshooting)
and [Cloud Storage billing requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024).

Keep the APK and signing material separate from `public/` and `dist/`; deploy
only the browser game and download page to Firebase. The existing full asset and
software notices in `public/THIRD_PARTY_LICENSES.md` are bundled inside the APK.
