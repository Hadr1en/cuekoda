# CueKoda architecture experiment status

Production source reference `a31211a41b5c016b5191eaccc4046183f25a55ad`, CueKoda 0.6.0. The three Rust integrations are based on **`147a2cfa656e254f2dea792c3c67cc47bf5dcad8`** and retain the same core source. The original checkout remains on its Beatport branch with its original untracked files.

| Phase | Delivered | Outstanding |
|---|---|---|
| P0 | [Source audit](CURRENT_ARCHITECTURE.md), 50 local Electron startup/idle trials, local DMGs, raw synthetic tests and local DJ reference aggregate. [PR #40](https://github.com/Hadr1en/cuekoda/pull/40) | Stage profiles, controlled warm/cold OS cache, GPU and long-session metrics. |
| P1 | Rust crate, CLI, read-only FFmpeg decode/tags, four-band peaks, resource caps/cancellation, tests and CI. [PR #41](https://github.com/Hadr1en/cuekoda/pull/41) | FFT and musical pipeline, loudness fields, persisted cache, full legacy and export contracts. |
| P1 bis | Same Electron UI with switchable Rust waveform backend, subprocess payload validation, paired tests and isolated installer. [PR #44](https://github.com/Hadr1en/cuekoda/pull/44) | Full Rust analysis, stage profiling, N-API comparison, extended input parity and physical Windows validation. |
| P2 | Tauri library with import/drop, virtualized list, waveform, playback and local media grants. Mac waveform and playback observed with agent-desktop. [PR #42](https://github.com/Hadr1en/cuekoda/pull/42) | Full frontend/API reuse, persistent edits, musical engine and interchange, installer, updater, physical Windows/Linux. |
| P3 | Native GPUI library, virtualized list, GPU waveform, native playback path and session cue slots. Graphical waveform smoke passed. [PR #43](https://github.com/Hadr1en/cuekoda/pull/43) | Accessible controls, actual audio/seek/cue validation, complete i18n, beatgrids, music and interchange, storage, display/GPU and distribution checks. |
| P4 | Measured Tauri list virtualization at four sizes. Excluded accidentally embedded Rust compiler outputs from the isolated Electron installer. | Profile production list costs. Measure memory, streaming, SIMD, GPU and scheduling on equivalent workloads. |
| P5 | Synthetic tests, pinned Ballroom annotations, three local DJ references, XML/NML round-trips and codec offsets. | Resolve intermittent rhythm result. Run paired corpus comparisons and cue listening, plus physical DJ application imports. |
| P6 | [Electron results](../benchmarks/RESULTS.md), paired waveform and Tauri list trials. | Four-way equivalent workload, physical Windows/Linux sessions, controlled OS caches, frames/input/GPU, peak resource use and sustained analysis throughput. |
| P7 | [Security and distribution audit](SECURITY_AND_DISTRIBUTION.md), npm audit and SBOM, experimental builds, separated identity/data. | Cross-platform installation, update signing, notarization, reproduction and license review. |
| P8 | [Decision criteria and musical gates](DECISION.md), [roadmap](MIGRATION_ROADMAP.md). | Complete evidence before scoring. Keep the current release pending comparable coverage and musical parity. |

## Verification

- Electron `typecheck`, 74 unit tests, synthetic end-to-end, smoke (three rounds) and offsets passed on Apple Silicon. Smoke reported zero renderer errors and three false informational UI probes. One rhythm run missed the UK garage cue, followed by four successful runs. Trap and hard techno downbeat ambiguities are preserved.
- `npm run corpora:verify -- ballroom <repo>` verified revision `1db08914a8ae15edb01f104046e30bad88effe67`. Three labelled local tracks matched. Rekordbox and Traktor were not found among the machine's installed applications.
- Rust core formatting, Clippy and four tests passed. The [macOS, Windows and Linux core CI](https://github.com/Hadr1en/cuekoda/actions/runs/45783088574) uploaded standalone CLI binaries. FFmpeg is required at runtime.
- Electron Rust output matched every bin on four input formats/variants, with ten paired runs per fixture. The macOS arm64 experimental DMG was built and signed ad hoc. The packaged smoke used four synthetic tracks and reused all four cache entries, with zero renderer errors.
- Tauri on macOS loaded a synthetic track and reached “Forme d’onde prête”. agent-desktop verified Play and Pause and the native file-selection sheet. The first Windows build lacked an ICO and the branch now includes the icon.
- GPUI used runtime Metal shaders because the local Command Line Tools lack the standalone Metal compiler. Its graphical smoke reached “Forme d’onde prête”. agent-desktop saw the native window and system controls only.

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

The three integration PRs are stacked on #41. See the build and test instructions in the [Electron/Rust evaluation](https://github.com/Hadr1en/cuekoda/blob/experiment/electron-rust/docs/architecture/ELECTRON_RUST_EVALUATION.md), [Tauri evaluation](https://github.com/Hadr1en/cuekoda/blob/experiment/tauri/docs/architecture/TAURI_EVALUATION.md) and [GPUI evaluation](https://github.com/Hadr1en/cuekoda/blob/experiment/gpui/docs/architecture/GPUI_EVALUATION.md).
