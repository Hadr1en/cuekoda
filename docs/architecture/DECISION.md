# Architecture decision

The release decision stays open. The Rust component implemented so far covers tags and waveform generation. The desktop POC workloads and the production application cover different functionality, so startup and artifact sizes cannot establish an architecture winner.

| Criterion | Weight | Rule |
|---|---:|---|
| Performance and resources | 25% | Same hardware and workload. Compare startup and batch medians/P95, resource peaks and sustained idle. |
| Maintainability and ecosystem | 20% | Compare API and dependency stability, active support, review effort and the cost of maintaining frontend and platform-specific code. |
| Fluidity and UX | 15% | Judge P95 frame times, input latency and keyboard/accessibility parity on the same interaction script. |
| Platform support | 10% | Count physical macOS and Windows verification first. Report Linux and ARM64 separately. |
| Migration effort | 10% | Inventory rewrites, format compatibility, skills, and estimates based on completed slices. |
| Security | 10% | Validate process boundaries, path grants, malformed inputs, dependency controls and update verification. |
| Packaging and updates | 5% | Validate artifact footprint, installation isolation, signatures, updates and rollback on each target. |
| Long-term prospects | 5% | Assess maintainer activity, breaking releases, runtime dependencies and replacement cost. |

For each criterion use 1 for substantial demonstrated regressions/risks, 3 for measured parity or a workable compromise, and 5 for a demonstrated material advantage with manageable maintenance. Use 2 and 4 for intermediate evidence. Keep unavailable ratings blank and publish the evidence coverage before any ranking. A significant musical or interchange regression blocks a migration even with a higher weighted score.

For paired comparisons, retain the existing automated round-trips and offset position tolerances. Freeze the BPM and phase gate from the existing test (2%, no octave error, 80 ms phase, no spurious drop and UK garage return within four beats). Require all versioned exported cues and grids to remain within existing test tolerances and allow at most 0.001 per waveform bin. For corpora, freeze per-corpus paired score deltas after repeatability is quantified, before evaluating Rust results. Downbeat ambiguities, model fallbacks and subjective cue review require their own records.

The observed cost of the 10,000-row Electron baseline justifies profiling and testing list virtualization within the existing UI. Electron plus Rust isolates a narrower change. Tauri can reuse visual tokens and browser playback but needs a production IPC and lifecycle port. GPUI requires native controls, native playback and accessibility work. Keep the current release architecture pending equivalent workflows, repeatable musical gates and same-machine measurements.

| Architecture | Existing evidence | Principal work before scoring |
|---|---|---|
| Electron and current engine | Complete production feature set and current-format support. Measured large-list costs and one intermittent rhythm result. | Profile DOM and musical fallback paths. Validate platform updates and signing. |
| Electron and Rust preview | Same UI and musical pipeline, exact tested waveform bins, slightly slower per-file median. Separate process boundary. | Measure memory and cancellation under load. Quantify full-engine migration and any N-API advantage. |
| Tauri and Rust preview | Native approval and WebView playback observed on macOS. Existing visual tokens and measured virtualization gains. | Reuse complete frontend workflows, port API and formats, measure native WebViews and verify signing. |
| GPUI and Rust preview | Native macOS build, virtualized list and GPU waveform. Accessibility gap observed. | Verify accessible widgets, playback and offsets, platform/GPU behavior, and finish missing native workflows. |

Prioritize equivalent list virtualization experiments in the existing application. The waveform trials justify retaining the Rust path as an experiment pending a wider workload. Revisit the architecture decision once the musical and interchange gates and comparable desktop workloads are available.

The four-way musical preparation trial now covers the same synthetic input through all four desktop shells with the existing algorithms. GPUI was about 5% faster than production Electron at the median on this input, with limited evidence on GPU, accessibility and bulk workloads. Electron with the Rust decoder was approximately level with the original decoder. This evidence does not qualify for a new architecture score or production migration. The isolated Tauri virtualized-list trial remains the clearest optimization result.

The opt-in Electron prototype measured a RSS median of 497 MiB versus 1,003 MiB and readiness of 455 ms versus 987 ms on an equivalent 10,000-row fixture. Prefer carrying this renderer optimization into a separate product qualification PR. The two matched musical preparation workloads support retaining the current shell and algorithms while profiling specific native stages.
