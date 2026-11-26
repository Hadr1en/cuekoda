# Security and distribution

| Architecture | Relevant boundaries | Distribution work |
|---|---|---|
| Electron | Sandboxed renderer, narrow preload surface, Node main, worker threads, ONNX process, FFmpeg process. Node workers are not a separate OS sandbox. Verify allowed file paths and subprocess lifecycle independently. | Windows x64 NSIS and macOS arm64/x64 DMG exist. Local DMGs are ad hoc signed. The configured hardened runtime is off. |
| Electron + Rust | The extra executable is isolated from JS in a separate process and the versioned response is bounded and validated. FFmpeg still executes separately. | The waveform trial runs in dev mode with an independent user-data directory. Packaging requires a signed Rust executable per target and a review of bundled FFmpeg. |
| Tauri 2 | Rust commands mediate native file approval. The prototype restricts WebView media scope to imported files and gives the renderer event-listening permissions. Confirm local path normalization and symlink races on the supported platforms. | WebView2 on Windows and system WebKit on macOS/Linux affect the deployment and validation matrix. An updater signature and OS code signing have different trust roles. Generate and store keys separately when establishing an updater channel. [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) · [Updater](https://v2.tauri.app/plugin/updater/) |
| GPUI | Native UI removes WebView and its IPC. GPUI, audio decoders, FFmpeg and GPU drivers remain in scope. Rust preview limits apply where the shared core is used. | No updater, notarization or installer validated. Check bundle metadata, OS signature, updater verification and accessibility by platform. |

The local npm audit flagged eight entries, including high severity entries for ONNX Runtime Node and adm-zip. Electron-builder and ONNX Runtime Node are direct dependencies. The development and runtime exposure differs. Preserve a locked dependency inventory and test model or installer behavior before applying upgrades. Full dependency and model license inventories remain open. Keep CI workflow permissions read-only for experiment builds. Do not use the production release workflow for experiment artifacts.

The baseline updater checks the SHA-256 digest supplied by the GitHub release API. Artifact signing, trust-root rotation and reproducible build verification remain distinct controls. Validate npm and Cargo advisories at release time, lock toolchains and packages, verify FFmpeg and model provenance, and test malformed audio and bounded decoding.

Windows ARM64, Linux installers, MSI/MSIX, Microsoft Store, Apple Developer ID and notarization are unverified. Validating operating-system signing requires the corresponding credentials. Native or WebView packaging does not determine SmartScreen reputation.

The lockfile-derived production npm CycloneDX 1.5 SBOM contained 59 components. The production-only npm audit reported two high severity entries (`adm-zip` and `onnxruntime-node`). Reproduce with `npm sbom --omit=dev --sbom-format=cyclonedx` and `npm audit --omit=dev --json`.

RustSec reported zero entries classified as vulnerabilities for the three lockfiles. It reported one unmaintained entry in the core, three unmaintained entries and one unsoundness advisory (`glib`, RUSTSEC-2024-0429) in the Tauri graph, and 14 unmaintained entries in the GPUI graph. These are lockfile-wide observations across target dependencies. Review dependency reachability and upgrades before release. Reproduce with `cargo audit --file <Cargo.lock>`.
