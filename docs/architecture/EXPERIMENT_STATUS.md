# CueKoda architecture experiment status

The Tauri and GPUI experiments were retired. Their draft PRs are closed and their active branches were removed. The source, CI records and measurements are historical references, recoverable through [the Tauri archive tag](https://github.com/Hadr1en/cuekoda/tree/archive/tauri-experiment) and [the GPUI archive tag](https://github.com/Hadr1en/cuekoda/tree/archive/gpui-experiment). The production Electron library change is tracked in [PR #45](https://github.com/Hadr1en/cuekoda/pull/45).

Production source reference `a31211a41b5c016b5191eaccc4046183f25a55ad`, CueKoda 0.6.0. The three Rust integrations are based on **`148a5aa`**, with identical core source across the experiments. Each raw benchmark records its own revision. The original checkout remains on its Beatport branch with its original untracked files.

| Phase | Delivered | Outstanding |
|---|---|---|
| P0 | [Source audit](CURRENT_ARCHITECTURE.md), 50 local Electron startup/idle trials, local DMGs, raw synthetic tests and local DJ reference aggregate. [PR #40](https://github.com/Hadr1en/cuekoda/pull/40) | Stage profiles, controlled warm/cold OS cache, GPU and long-session metrics. |
| P1 | Rust crate, CLI, audio decoding and waveform, variable beatgrid projection, local worker protocol and cross-platform tests. [PR #41](https://github.com/Hadr1en/cuekoda/pull/41) | Port FFT, rhythm, tonal analysis, vocal inference and composition heuristics to Rust if a measured advantage justifies the work. The current Node worker provides these algorithms and exact legacy-format logic. |
| P1 bis | Same Electron UI and musical analyzer with switchable Rust decoding and waveforms, separated cache keys, M3U8 import and isolated installer. [PR #44](https://github.com/Hadr1en/cuekoda/pull/44) | Stage profiling and physical Windows validation. A full native musical engine or N-API integration would be a separate experiment. |
| P2 | Tauri library, virtualized list, native approvals, music analysis, variable beatgrid, sections, cue edits that survive restart, and XML/NML/M3U8 workflows. [PR #42](https://github.com/Hadr1en/cuekoda/pull/42) | Production UI and bulk workflows, signed installer and updater, physical Windows/Linux. |
| P3 | Native GPUI library and audio, virtualized GPU waveform, musical analysis, variable beatgrid, persistent cues and XML/NML/M3U8 workflows. Graphical preparation smoke passed. [PR #43](https://github.com/Hadr1en/cuekoda/pull/43) | Accessible controls, interactive cue validation, complete i18n, bulk workflows, display/GPU and platform distribution checks. |
| P4 | Measured Tauri list virtualization at four sizes and the opt-in Electron virtualizer at 10,000 rows. Excluded accidentally embedded Rust compiler outputs from the isolated Electron installer. | Qualify opt-in Electron virtualizer accessibility and selection on real mixed-size libraries. Measure streaming, SIMD, GPU and scheduling. |
| P5 | Four matched codec fixtures (full musical fields, three exports, cue retention), three paired local DJ references, pinned Ballroom annotations and codec offsets. | Resolve intermittent rhythm result and widen labelled corpora. Run cue listening and physical DJ application imports. |
| P6 | [Electron results](../benchmarks/RESULTS.md), paired waveform and Tauri list trials, plus the 80-run four-architecture import-to-prepared benchmark on macOS. | Physical Windows/Linux sessions, controlled cold OS starts, frame and input latency, process-tree peaks, GPU metrics and sustained bulk throughput. |
| P7 | [Security and distribution audit](SECURITY_AND_DISTRIBUTION.md), npm audit and SBOM, experimental builds, separated identity/data. | Cross-platform installation, update signing, notarization, reproduction and license review. |
| P8 | [Decision criteria and musical gates](DECISION.md), [roadmap](MIGRATION_ROADMAP.md). | Complete evidence before scoring. Keep the current release pending comparable coverage and musical parity. |

## Verification

- Electron `typecheck`, 74 unit tests, synthetic end-to-end, smoke (three rounds) and offsets passed on Apple Silicon. Smoke reported zero renderer errors and three false informational UI probes. One rhythm run missed the UK garage cue, followed by four successful runs. Trap and hard techno downbeat ambiguities are preserved.
- `npm run corpora:verify -- ballroom <repo>` verified revision `1db08914a8ae15edb01f104046e30bad88effe67`. Three labelled local tracks matched. Rekordbox and Traktor were not found among the machine's installed applications.
- Rust core formatting, Clippy and four tests passed. The [macOS, Windows and Linux core CI](https://github.com/Hadr1en/cuekoda/actions/runs/45783088574) uploaded standalone CLI binaries. FFmpeg is required at runtime.
- Electron Rust output matched every bin on four input formats/variants, with ten paired runs per fixture. The macOS arm64 experimental DMG was built and signed ad hoc. The packaged smoke used four synthetic tracks and reused all four cache entries, with zero renderer errors.
- Tauri on macOS loaded a synthetic track and reached “Forme d’onde prête”. agent-desktop verified Play and Pause and the native file-selection sheet. The Windows ICO fix was confirmed by [green macOS, Windows and Linux builds](https://github.com/Hadr1en/cuekoda/actions/runs/45785434164).
- GPUI used runtime Metal shaders because the local Command Line Tools lack the standalone Metal compiler. Its graphical smoke reached “Forme d’onde prête”. agent-desktop saw the native window and system controls only. A muted test opened the native audio output, advanced the playhead, sought and paused.

## Resume

```sh
# feature/architecture-benchmarks
npm ci
npm run test:all
npm run smoke
npm run benchmark:rhythm -- --json /tmp/cuekoda-rhythm.json
npm run offset-test
node scripts/electron-desktop-benchmark.mjs /tmp/cuekoda-electron-10000.json 10 10000

# feature/rust-core or an integration branch
CUEKODA_TEST_FFMPEG=/absolute/path/to/ffmpeg \
  cargo test --locked --manifest-path rust/cuekoda-core/Cargo.toml
```

## Downloadable builds

- [Rust core executables for macOS, Windows and Linux](https://github.com/Hadr1en/cuekoda/actions/runs/45790102100).
- [Electron Rust experiment DMG and Windows installer](https://github.com/Hadr1en/cuekoda/actions/runs/45790242706).
- [Tauri experiment with its musical runtime](https://github.com/Hadr1en/cuekoda/actions/runs/45790243549).
- [GPUI experiment with its musical runtime](https://github.com/Hadr1en/cuekoda/actions/runs/45790243729). The first Linux build failed because of a transitive `xattr` / libc incompatibility. All three platforms compiled after pinning the affected dependencies. The [playback-test build](https://github.com/Hadr1en/cuekoda/actions/runs/45786302866) includes the added local audio test.

The native prototypes and CLI require an FFmpeg executable. Platform builds do not validate interactive GPU or audio behavior on their host OS.

The three integration PRs are stacked on #41. The new Tauri and GPUI artifacts include the native app, Rust core, bundled worker and models. On macOS and Linux, restore the executable bits after extracting the artifact with `chmod +x bin/*`. Inside the extracted artifact, run `npm ci --omit=dev` with Node installed and start the app with `node scripts/launch-native-experiment.mjs bin/cuekoda-tauri` or `node scripts/launch-native-experiment.mjs bin/cuekoda-gpui`. Add the `.exe` suffix on Windows. Music, imports and exports use the existing algorithms through the local worker. See the build and test instructions in the [Electron/Rust evaluation](https://github.com/Hadr1en/cuekoda/blob/experiment/electron-rust/docs/architecture/ELECTRON_RUST_EVALUATION.md), [Tauri evaluation](https://github.com/Hadr1en/cuekoda/blob/archive/tauri-experiment/docs/architecture/TAURI_EVALUATION.md) and [GPUI evaluation](https://github.com/Hadr1en/cuekoda/blob/archive/gpui-experiment/docs/architecture/GPUI_EVALUATION.md).

## Final local acceptance of the shared workload

- The four desktop variants completed 80 single-track preparation trials (WAV and AAC, ten per mode). Match criteria covered BPM, key, cue and section counts. The deeper codec comparison checked all musical fields and normalized format output.
- Electron's complete TypeScript test suite passed with the Rust PCM executable enabled. The normal Electron renderer smoke completed with its opt-in virtual library and verified switching tracks, search, details and edits.
- On macOS, agent-desktop verified a Tauri analysis result, created pad H using the UI and observed it after an app restart that restored the analyzed track. An independently downloaded GPUI release artifact completed its graphical analysis smoke after installing runtime dependencies and restoring executable permissions.
- The measurements support a virtualized Electron library trial. Bulk musical workloads, broader labelled samples, physical GPU/audio checks, proprietary DJ app imports, packaging signatures and updaters remain outside the measured coverage. The shared native shell mode uses the original music algorithms in a local Node worker.
