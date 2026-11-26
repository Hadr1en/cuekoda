# Current architecture — preliminary audit
Baseline: a31211a41b5c016b5191eaccc4046183f25a55ad, version 0.6.0, AGPL-3.0-or-later.
Verified from package.json, README.md and docs/ENGINE_VALIDATION_0.6.0.md. Source-level audit is incomplete.
- Electron 45, Node >=22.12, TypeScript/esbuild. FFmpeg executable, Essentia.js, TensorFlow.js WASM, ONNX Runtime Node, fft.js, music-metadata, xmldom.
- Existing native and WASM computation must be profiled separately from JS and IPC before replacement.
- README documents parallel analysis, CPU limit, cancellation, cache, manual correction preservation, waveform interaction, audio playback, exports and GitHub release checks. Implementation details remain to audit.
- Packaging: electron-builder, macOS 13+ arm64/x64 DMG, Windows x64 NSIS; ad-hoc mac identity, hardenedRuntime false; no evidence of notarization. Linux/Windows ARM64 not established.
- Historical validation: 73 unit tests, 3 smoke rounds, 5 synthetic rhythm cases, XML/NML offsets and actual Traktor 3.5.1 import. Not rerun here.
- Audit pending: complete file tree, IPC handlers/preload, worker lifecycle, analysis stages and model licenses, cache format, persistence, waveform renderer, update verification, CI permissions and current status.
- Bottlenecks are unknown until profiling. Do not infer from dependencies.
