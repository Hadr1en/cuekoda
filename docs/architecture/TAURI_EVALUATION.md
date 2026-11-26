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
