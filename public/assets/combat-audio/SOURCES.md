# IslandWorld firearm audio

Acquired and checked 2026-10-02. All shipped audio is CC0 1.0 and permits
commercial redistribution. No music, film clips, or celebrity voices are used.

## Recorded gunshots

- **The Free Firearm Sound Library** by Ben Jaszczak, Brian Nelson, Kevin Heras,
  and Matthew Nanney. The creators dedicate their library to CC0.
- [Source and license declaration](https://opengameart.org/content/the-free-firearm-sound-library)
- [Downloaded prepared archive](https://opengameart.org/sites/default/files/Prepared%20SFX%20Library.7z)
- Archive SHA-256: cc1ab5a99a0a365105c7c5dd783f4b0b1fe90938114d3ceec53856bfe005f7d6
- Shipped excerpts are from individual near-distance reports, not burst
  recordings. The LMG uses adapted 7.62mm AK-47 single reports; it is an audio
  design choice, not a claim that its model is an AK-47.

## Recorded mechanical reload foley

- **Gun reload sounds** by SpringySpringo, recorded by the creator using airsoft
  guns and dedicated to CC0.
- [Source and license declaration](https://opengameart.org/content/gun-reload-sounds)
- Original files: [gunreload1.wav](https://opengameart.org/sites/default/files/gunreload1.wav),
  [assaultriflereload1_0.wav](https://opengameart.org/sites/default/files/assaultriflereload1_0.wav),
  [shotguncock_0.wav](https://opengameart.org/sites/default/files/shotguncock_0.wav).
- The shotgun cue is a pump/cocking sound. The revolver uses generic mechanical
  foley; these are stylized cues timed to the game's authored reload animation.

## Conversion and runtime

Extracted reports, downmixed to mono, encoded as 48kHz VBR MP3 for browser
compatibility, normalized to a pre-encode peak of 0.68 (gunshots) or 0.60
(foley), with short entry/exit fades. Two different recorded reports per gun
plus subtle playback-rate variation prevent machine gun bursts sounding like
an identical repeated click. All 13 files total 125,672 bytes. Decoded sample
peaks were checked after encoding: gunshots 0.668–0.700, foley 0.613–0.644;
all files contain finite audio and have no full-scale clipping.

Runtime caps concurrent reports at 16, reduces automatic weapon gain, uses a
compressor, soft safety limiter and a bounded master level, and applies directional pan, distance
filtering and acoustic delay to remote reports. The procedural fallback is
original project code, used if loading or decoding a recording fails.

[CC0 1.0 deed](https://creativecommons.org/publicdomain/zero/1.0/) /
[CC0 1.0 legal text](https://creativecommons.org/publicdomain/zero/1.0/legalcode)

## Shipped excerpts

| File | Original prepared recording | Start (s) | Excerpt length (s) | SHA-256 |
| --- | --- | ---: | ---: | --- |
| revolver-1.mp3 | Smith & Wesson 642/V_27P.wav | 0.785 | 0.85 | 096b16f584ecd6546cb0d1bccb22eca2b4f62812a618b12f5127649032841ba1 |
| revolver-2.mp3 | Smith & Wesson 642/V_27P.wav | 6.195 | 0.85 | 1219c83c5560242f4dc1661e2244c1caea9871f13b9a5924c48cbf35c35b10f4 |
| rifle-1.mp3 | Tikka/W_29P.wav | 0.555 | 1.1 | 1ccbf5e7213cdd4468560685b7c2222dd904b82de1746b8e784ff42dbd9ab94b |
| rifle-2.mp3 | Tikka/W_29P.wav | 5.645 | 1.1 | 3bc278932a14e05b2ca6273842dd8418d1dd9366432f960df2fb705cfaba21fc |
| shotgun-1.mp3 | CD/H_21P.wav | 0.445 | 1.0 | 11433b84e2d1bb90f01912eaa24bae48826c821e5e23f61a6f8f8b0fbb609228 |
| shotgun-2.mp3 | CD/H_21P.wav | 3.055 | 1.0 | 91d87f4e5c41366021378e21b7e88b50b435f227394a72d8a70d1f4a4948a924 |
| smg-1.mp3 | Carl Gustav M45/G_31P.wav | 0.295 | 0.4 | 6b8711100c95738af706a3a3a352c329cec1cbeb36f764ec490e418289f9f7ae |
| smg-2.mp3 | Carl Gustav M45/G_31P.wav | 3.485 | 0.4 | 7cca942371e49f4f57ab3573d245bd048078330bd68789957854b8de904755d3 |
| lmg-1.mp3 | AK-47/C_28P.wav | 0.595 | 0.55 | 9a468b5d923f95bce0a26bdec10f52c0f48b4d928b06570d696a58fdbc413a66 |
| lmg-2.mp3 | AK-47/C_28P.wav | 3.235 | 0.55 | cc448eaaed7733adcef48f9b9f1c9a55aec799a13c8eef0df2fcae89b32193a4 |
| reload-handgun.mp3 | reload-handgun.wav | 0 | 1.579 | 5df6fbac265424506778cea6dd9879597fdacb1c32330e97c1ca13f2c6c53724 |
| reload-rifle.mp3 | reload-rifle.wav | 0 | 1.556 | b371a81436a5e71d5b17e2b874e21d4226040bb6b28928a39833d291e51801cd |
| reload-shotgun.mp3 | shotgun-cock.wav | 0 | 0.474 | cdc3c95b28b89df872c6974c2f320bcb8802228f512bd84cc6c41ec384a5df3d |
