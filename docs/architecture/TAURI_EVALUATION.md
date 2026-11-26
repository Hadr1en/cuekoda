# Tauri 2 experiment

Core revision `147a2cfa656e254f2dea792c3c67cc47bf5dcad8`. This uses Tauri 2.12.7, the shared Rust preview and existing CueKoda CSS tokens. The prototype's library supports native file/folder import and drop handlers, title sort/search, virtualized rows and keyboard navigation. The approved audio path is shared directly with the WebView's scoped media protocol. Analysis cancellation and progress use separate Rust commands and events. Only waveform bin data and basic tags cross IPC. Themes, waveform zoom/panning, seek and native WebView audio are available.

On macOS arm64, a development executable opened with a synthetic input. Using `agent-desktop`, the analysis button reached “Forme d’onde prête” and the audio control changed from Play to Pause. The accessibility tree exposed the search field, library, buttons and waveform sliders. Drag-and-drop, cancellation delivery, Windows WebView2, Linux WebKitGTK and media offsets need interactive verification.

```sh
npm ci
node experiments/tauri/build.mjs
cargo build --locked --manifest-path rust/cuekoda-tauri/Cargo.toml
CUEKODA_EXPERIMENT_FFMPEG=/absolute/path/to/ffmpeg \
  rust/cuekoda-tauri/target/debug/cuekoda-tauri /path/to/track.wav
```

The binary uses FFmpeg on PATH by default. It keeps a session-only library, with its own Tauri identifier. Production preferences and caches are outside that session. The prototype covers media preview, leaving musical analysis, analysis persistence, sections, cue editing, import/export parity, equivalent frontend reuse, packaging and updates for later work. The CI workflow produces separate native executable artifacts, without publishing to the production channel. [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) · [Tauri updater](https://v2.tauri.app/plugin/updater/)

## Virtualized library measurement

On the same Apple M5 macOS development build, mount the same synthetic rows ten times in each mode with the virtualizer enabled and disabled. A forced layout measures DOM work and layout. Two animation frames give an additional renderer-side proxy. Measured samples use the same window size and no audio. The harness also checks content height and the ability to scroll to the final row.

| Synthetic rows | Full DOM med/P95, ms | Virtualized DOM med/P95, ms | Mounted with virtualization |
|---:|---:|---:|---:|
| 10 | 1 / 1 | 1 / 2 | 10 |
| 100 | 3 / 4 | 1 / 2 | 28 |
| 1,000 | 14 / 17 | 1 / 1 | 28 |
| 10,000 | 58 / 72 | 0.5 / 1 | 28 |

At 10,000 rows the two-frame median was 83 ms with the full DOM, 33 ms with virtualization. These are in-prototype layout comparisons. The full app readiness, input presentation and GPU activity are distinct metrics. [Raw samples](../benchmarks/raw/tauri-library-virtualization-macos-arm64.json)

```sh
rust/cuekoda-tauri/target/debug/cuekoda-tauri --library-benchmark > /tmp/tauri-library.json
```

The Windows CI initially failed because Tauri requires an ICO for its executable resources. The experiment now supplies it from the existing CueKoda artwork.
