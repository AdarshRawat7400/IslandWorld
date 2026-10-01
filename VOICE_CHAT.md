# IslandWorld room voice

Room voice uses LiveKit's WebRTC SFU. Each participant sends one audio stream;
the relay distributes it to the other room members and supplies TURN fallback
for networks that cannot connect directly. Socket.IO continues to own game
membership and game state. No audio, recordings, or speech transcripts are sent
through gameplay snapshots. The Third Light is unaffected.

## Player controls

- Join a private game room, open **Room Voice**, and select **Join Voice**.
  Joining starts listening with the microphone off. Select the microphone button
  to allow microphone access and enable speaking.
- Desktop defaults to push-to-talk: enable the microphone, then hold **V** while
  exploring to speak. The menu also offers open microphone mode.
- On mobile, **MORE → VOICE** joins listening. **MIC OFF** enables the microphone
  on a second explicit tap, and **MIC ON** turns it off. Volume, individual mute,
  deafen, and leave controls remain in the menu.
- Voice names and speaking indicators follow the game roster. Per-player volume
  and mute affect only what you hear. Deafen silences incoming voice.
- Leaving the room or voice, losing membership, changing browser identity, or
  closing the page stops microphone tracks and removes playback elements.
  A transient reconnect can restore listening in the same approved room; the
  microphone remains off until enabled again. Backgrounding the game disables
  the microphone. Browser-denied audio playback offers an explicit retry button.

Voice requires HTTPS (or localhost for development), a compatible WebRTC
browser, and explicit microphone permission. Microphone denial does not prevent
gameplay or listening. Headphones help avoid feedback.

## Server configuration

Keep these three settings **only on the game server**:

| Variable | Purpose |
| --- | --- |
| `LIVEKIT_URL` | LiveKit project's public `wss://` endpoint |
| `LIVEKIT_API_KEY` | Server API key |
| `LIVEKIT_API_SECRET` | Server API secret |

No `VITE_` secret variables are needed. Firebase receives only the public game
build. The game server issues short-lived tokens after checking its own bound
Socket.IO session; a caller cannot choose another room, player identity, or name.
Tokens grant only microphone audio publication and subscription. Video, screen
sharing, data publication, and room administration are not granted. Each game
room has a unique voice-room identity, even if its join code is reused later.
Membership revocation and empty-room cleanup use the server API. Cleanup errors
are bounded and never break combat or room state.

LiveKit Cloud revokes previously issued credentials when a member is removed.
Self-hosted LiveKit does not provide the same credential revocation guarantee;
an unused token can remain usable until its 60-second expiry. Use the Cloud
configuration for the strongest room-membership enforcement.

For local configuration, copy `.env.voice.example` to `.env.voice.local`, replace
the three values, then run:

```powershell
node --env-file=.env.voice.local server/index.js
npm run dev
```

Run the two commands in separate terminals. Without credentials, rooms still
work and the UI explains that voice hosting has not been configured. `/healthz`
reports public voice availability without exposing credentials.

## Online deployment

1. Create a LiveKit Cloud project on the **Build (free)** plan or provide a
   compatible self-hosted LiveKit server. No paid plan or card is required for
   the free cloud plan.
2. Add the three environment variables to the existing Render
   `islandworld-room-server` service. Do not create a second gameplay service.
3. Deploy the room server, check `/healthz`, then build and deploy Firebase:

```powershell
npm test
npm run build
firebase deploy --only hosting --project islandworld-3ccb4
```

Render restarts end in-memory game rooms; players should create a fresh room
after a server rollout. LiveKit's free allowance is a hard cap rather than a
paid overage: voice may become unavailable when it is exhausted. Gameplay remains
available. Check the current allowance in the provider dashboard.

## Verification

Automated coverage exercises room isolation, token permissions, membership
changes while a token is being issued, credential rate limits, revocation,
mute/deafen/volume, push-to-talk, stale microphone permission results, media
cleanup, SDK reconnects, and UI lifecycle. A local media test uses a real LiveKit
server and browser-generated tones instead of recording a user's microphone.
Two independent Chrome identities exchanged decoded audio in both directions;
push-to-talk starts silent, transmits while held, and stops on release. Muting
stops the generated local media track. Production builds and the existing game
test suite are checked alongside the voice tests.
The completed local checks passed all 244 tests and a production build.
Browser checks also confirmed authenticated room reconnection returns to
listen-only, the creator can leave while another member remains, and the mobile
voice button fits inside the existing MORE drawer at 667 x 375. Leaving a room
preserves solo exploration. No real microphone was captured for these checks.
Real-device microphone/headset and different-network checks are separate from
mocked unit checks and local generated-audio verification.

## Sources and licenses

- [LiveKit JavaScript SDK](https://github.com/livekit/client-sdk-js), Apache 2.0.
- [LiveKit server SDK](https://github.com/livekit/node-sdks), Apache 2.0.
- [LiveKit SFU architecture](https://docs.livekit.io/reference/internals/livekit-sfu/).
- [Current free quotas and hard-cap policy](https://docs.livekit.io/deploy/admin/quotas-and-limits/).
- [Server token permissions](https://docs.livekit.io/frontends/reference/tokens-grants/).
