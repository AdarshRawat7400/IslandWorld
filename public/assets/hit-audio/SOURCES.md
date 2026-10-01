# IslandWorld hit vocal sources

Retrieved and license-checked on 2026-10-02. All recordings below are **CC0 1.0 Universal** and permit redistribution and commercial use. The full legal text is included in `CC0-1.0.txt` and is available at <https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt>.

## Human pain vocals

- Work: **Hurt Sound Effects**
- Creator: **EZduzziteh**
- Official creator page and CC0 declaration: <https://opengameart.org/content/hurt-sound-effects>
- Six original nonverbal hurt/grunt recordings. Files were renamed locally; their audio bytes are unchanged. No celebrity voices or film audio are used.

| Local file | Official download | Duration | SHA-256 |
| --- | --- | --- | --- |
| hurt-01.mp3 | https://opengameart.org/sites/default/files/hurt_01_0.mp3 | 0.264 s | 45f19e4f637ff0e8936186977aa7cb131f67a95ca68660686476a47da224322e |
| hurt-02.mp3 | https://opengameart.org/sites/default/files/hurt_02.mp3 | 0.254 s | 7c4cd404830bf3cd5f10ff3340266f573922399d06bfb4573daf9093c5b69833 |
| hurt-03.mp3 | https://opengameart.org/sites/default/files/hurt_03.mp3 | 0.176 s | 9950c1dbbf3f2c75952510f1f2a2ab6f36586ba7e62f4f1e74ad64e82db2aa52 |
| hurt-04.mp3 | https://opengameart.org/sites/default/files/hurt_04.mp3 | 0.225 s | a6249c89f037553c71529ece4eb443bd3cc06ab33b833c5b3d47121da284d7d8 |
| hurt-05.mp3 | https://opengameart.org/sites/default/files/hurt_05.mp3 | 0.410 s | a70d46a0a20c1e231fdfd4e8154248be9a5e0ff38e84fa08eaf7f25dea749e93 |
| hurt-06.mp3 | https://opengameart.org/sites/default/files/hurt_06.mp3 | 0.205 s | 01bc209cec8f344cad5f7c77eaad0f8a00a6d64c649b514c7ff423d02aec5085 |

## Sheep vocal

- Work: **Sheep Baa**
- Source recording: **mikewest**, repackaged by **AntumDeluge**
- Official page and CC0 declaration: <https://opengameart.org/content/sheep-baa>
- Official download: <https://opengameart.org/sites/default/files/sheep_baa_0.ogg>
- Local file: `sheep-baa.ogg`, unchanged audio bytes, duration 0.872 s.
- SHA-256: `88618dd49eaadaeea8950a613e75588cccecb39b699e289004dd56d1f3aef9de`.
- Used as a brief startled sheep vocal with subtle playback-rate variation.

## Original synthesized voices

`src/hitAudio.js` generates short, cached breathy grunts and animal chirps if recordings fail to load. Bird and rabbit hit calls use these original, species-distinct synthesized sounds. They contain no third-party recordings. All vocals are bounded, attenuated by distance, filtered, softly faded, and mixed at a comfortable gain.
