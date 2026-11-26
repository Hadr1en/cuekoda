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
