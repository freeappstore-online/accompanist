# Accompanist

A piano accompanist for singers. Choose a song, turn on voice commands and say “from bar 5”, “from the beginning”, “play”, “stop”, “slower” or “faster”. Everything also works with buttons and the keyboard.

- Live: https://accompanist.freeappstore.online
- Install: `pnpm install` · Develop: `pnpm dev`
- Validate: `pnpm typecheck && pnpm test && pnpm build && fas check`
- Deploy: push to `main`.

## How it works

- **Score and timeline.** Each song is a MusicXML score plus a MIDI accompaniment. MIDI parsing, the tempo map, the MusicXML bar map, transposition bounds and the count-in rhythm are borrowed from [scoreplay](https://github.com/freeappstore-online/scoreplay) (`music.ts`, `original-score.ts`, `practice.ts`). Notation is engraved with OpenSheetMusicDisplay (lazy-loaded) and its cursor follows playback (`Score.tsx`, adapted from scoreplay's `OriginalScore.tsx`). Spoken bar numbers resolve to the printed bar label, so a pickup bar stays bar 0.
- **Piano.** SpessaSynth's `WorkletSynthesizer` with the GeneralUser GS bank, a static asset that is precached and checked against a pinned SHA-256 (`sound-cache.ts`, from scoreplay). Unlike scoreplay, no `Sequencer` is used: `accompanist.ts` maps song time to audio time through an anchor and a speed, and queues notes about 120 ms ahead. Tempo can therefore change continuously, which the singer-following milestone (#2) depends on. The synth cannot cancel queued events, so each playback session uses its own MIDI channel; stopping mutes that channel (`piano.ts`).
- **Voice commands.** The browser's speech recognition in continuous mode (`voice.ts`). Every finished phrase is parsed into a command (`commands.ts`), with number words and common mishearings such as “bar for”. In some browsers, including Chrome, speech audio goes to the browser maker's speech service; this app stores nothing. Headphones keep the piano out of the microphone. The parser is separate from the recognizer, so a fixed-grammar on-device recognizer can replace it later (#3).

## Songs

Per-song assets live in `web/public/songs/<id>/` (`score.musicxml`, `accompaniment.mid`). They load on demand and are deliberately excluded from the offline precache. That is the source of the expected `fas check` warning about `.mid` and `.musicxml` files. *Caro mio ben* is built by `pipeline/caro_mio_ben.py` from the Mutopia Project's public-domain edition (voice and piano): the script pins the upstream files by hash, keeps only the piano tracks for playback and writes a voice-and-piano score with Italian and English words. The three seed songs are public-domain nursery arrangements from Project Gutenberg's *The Baby's Opera* and *The Baby's Bouquet*, transcribed by Linda Cantoni. They were reviewed for scoreplay; their source terms are in `web/public/songs/`. `web/songs-provenance.json` pins each upstream URL and SHA-256, and `pnpm test` verifies them along with the bar map.

The offline preparation pipeline (expressive rendering, follow and command assets, a dedicated grand piano bank) is tracked in #3. Following the singer's tempo is tracked in #2.

## Credits

GeneralUser GS by S. Christian Collins (`web/public/sounds/GeneralUser-LICENSE.txt`); SpessaSynth, Apache-2.0 (`web/public/sounds/SpessaSynth-LICENSE.txt`). App code MIT.
