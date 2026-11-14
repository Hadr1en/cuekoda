<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/png/cuekoda-logo-sombre@2x.png">
    <img src="assets/logo/png/cuekoda-logo-clair@2x.png" alt="CueKoda — Analyze. Cue. Mix." width="560">
  </picture>
</p>

# CueKoda — *Analyze. Cue. Mix.*

🇫🇷 [Version française](README.md)

**Track preparation for DJs** (Windows / macOS, Electron). CueKoda is not mixing software: it turns raw
audio files into analysed, structured and annotated tracks, ready for rekordbox, Traktor and other DJ
software. **CueKoda prepares, the DJ decides**: every suggestion is explained and rated for confidence, you
can edit all of it, and your corrections survive re-analysis.

Everything runs locally. No audio file is ever uploaded, modified or moved.

## What CueKoda does (v0.3)

- **Analysis**: BPM (half/double time, stability, confidence), beatgrid and downbeat, key (Camelot / Open
  Key, ambiguity flagged), LUFS / true peak, 1–10 energy and energy curve, 8/16/32-bar phrases, section
  timeline (intro, build-up, drop, breakdown, outro… without forcing EDM terms).
- **Preparation**:
  - hot cues placed from the music, each with a name, a colour per function, a confidence level and the
    reason it was placed;
  - drops found from energy tiers and the bass entry; the downbeat is voted from kick / bass entries;
  - suggested loops, explained Mix In / Mix Out points, compatible tracks;
  - duplicates via an acoustic fingerprint;
  - experimental vocal detection.
- **Editing**:
  - zoomable waveform with draggable, snapped cues;
  - "+ Cue here" and memory cues beyond the 8 pads;
  - rename, recolour, lock, undo / redo;
  - BPM / grid / key correction; sections follow their cues; editable vocal parts; loops.
- **Mixing help (low-key)**:
  - transition preview A → B: tempo matched without changing the key, beats aligned, 16-bar crossfade;
  - **mix-order suggestion** for the tracks on screen: energy arc, explained transitions, hard ones flagged.
  
  Nothing is applied on its own: building the set stays the DJ's job.
- **Library**:
  - parallel analysis queue with visible progress (stage and percentage per track, place in the queue);
  - pause, cancel, retry, CPU limit;
  - content-based cache, persistence, watched folders, custom DJ profiles, simple learning.
- **Export**: one "Export…" button, then pick your software. You see a preview of what will be transferred
  and the import steps, and any existing file is backed up first.

  | Software | File written | Import |
  |---|---|---|
  | rekordbox | rekordbox XML | ✅ checked by a DJ |
  | Traktor Pro | Traktor NML | ✅ checked by a DJ |
  | Engine DJ (Denon / Numark / Rane) | rekordbox XML | to be checked |
  | VirtualDJ | rekordbox XML | to be checked |
  | djay Pro | rekordbox XML | to be checked |
  | Serato DJ Pro | — | unavailable: Serato keeps its cues inside the audio files, which CueKoda never modifies |

  Details in the [export matrix](docs/MATRICE_EXPORT.md) (French).
- **French or English interface** (Settings › Language).

## Download

Installers are rebuilt automatically on every commit to `main` (GitHub Actions) and published in the
[Releases](https://github.com/Hadr1en/cuekoda/releases/latest):

| System | File |
|---|---|
| macOS 13+ Apple Silicon (M1–M4) | `CueKoda-<version>-mac-arm64.dmg` |
| macOS 13+ Intel | `CueKoda-<version>-mac-x64.dmg` |
| Windows 10/11 64-bit | `CueKoda-<version>-windows-setup.exe` |

The app is not signed with an Apple / Microsoft certificate yet:
- **macOS**: drag CueKoda to Applications, open it once, then System Settings › Privacy & Security ›
  **Open Anyway**.
- **Windows**: at the SmartScreen warning, **More info** › **Run anyway**.

### Automatic updates
At start-up, CueKoda checks for a newer version. You can turn this off in Settings › Updates. Only GitHub is
contacted, and no library data is sent. Updates install on a click, after the downloaded file is checked
(size and SHA-256 digest):
- **Windows**: silent install, then restart;
- **macOS**: the old version goes to the Trash, the new one takes its place and restarts.

Versions before 0.3.4 do not include the updater: install the latest version manually once.

Build locally: `npm run dist:mac` (DMG arm64 + x64) or `npm run dist:win` (on Windows).

## Getting started

```bash
npm install
```

```bash
npm start
```

## Tests

```bash
npm run test:all
```

```bash
npm run test:regression
```

```bash
npm run smoke
```

- `test:all`: typecheck, unit tests, and an end-to-end test on synthetic tracks. The unit tests cover
  matching, duplicates and fingerprint, profiles, merging, exports, the analysis queue, evaluation, updates,
  mix order and translation.
- `test:regression`: re-analyses `samples/` and compares the results with `tests/baselines/samples.json`.
- `smoke`: starts the real Electron app with no visible window on `samples/`. It drives the UI (cue editing,
  undo, export picker, mix order, transition preview, audio playback) and writes `smoke-report.json`.
- `eval`: measures engine accuracy on the tracks you validated as references in the app.

Command line (same engine):

```bash
npm run build && node dist/cli/cli.js ~/Music/MyFolder --profile house --out output
```

## Documentation (French)

- [User guide](docs/GUIDE_UTILISATEUR.md)
- [Algorithms and limits](docs/ALGORITHMES.md)
- [Export compatibility matrix](docs/MATRICE_EXPORT.md)
- [Audit, architecture, plan and feature status](docs/AUDIT_ET_PLAN.md)

## Architecture

```
src/core/       pure engine (decoding, tempo, grid, key, energy, structure, cues, loops, mix, profiles,
                merge, matching, duplicates, learning, mix order, transitions, export/ adapters)
src/main/       Electron: persistent library, cache, analysis queue (workers), watched folders, updater
src/renderer/   UI (library, analysis view, dialogs) — plain HTML/CSS/TS, no framework
src/shared/     IPC types, update logic, translation (i18n)
src/test/       unit, end-to-end, regression, diagnostics
```

Stack:
- Electron 45 (macOS 13+ or Windows 64-bit only), TypeScript, esbuild, electron-builder.
- Essentia.js (AGPL-3.0), ffmpeg-static (GPL binary), music-metadata.
- Vocal detection: TensorFlow.js (Apache-2.0) and the `voice_instrumental-musicnn-msd-2` model from the
  Music Technology Group (UPF), licensed CC BY-NC-SA 4.0. CueKoda is free and non-commercial.

## License
No license has been chosen for CueKoda's own code yet. Because Essentia.js is AGPL-3.0, distributing the app
must stay AGPL-compatible (the public source code helps with that).

## Known limits
- rekordbox and Traktor imports were checked by a DJ; Engine DJ, VirtualDJ and djay Pro not yet.
- Vocal detection is experimental and not validated on annotations; no stem separation.
- Changing tempo: tempo markers are exported to rekordbox, but cues and sections use the average grid.
- Energy and confidence levels are not calibrated on an annotated corpus.
