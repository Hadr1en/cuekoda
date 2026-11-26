# Migration roadmap

1. Reproduce the intermittent UK garage reference result with explicit model availability and stage timings. Profile Electron’s large-library path, and validate a DOM virtualization change for performance, selection and accessibility.
2. Validate the Rust waveform slice using the same FFmpeg executable across representative formats, long tracks and variable encoder offsets. Run the two Electron modes with identical library snapshots and profiles. Quantify launch/IPC, temporary memory and cancellation cost before selecting N-API or keeping the process boundary.
3. Port equivalent library, persistence, analysis, manual edits and export workflows in Tauri and GPUI. Keep one pinned core revision, with the original models and fixtures. Establish an audio playback decoder strategy using the offset fixtures before claiming playback parity.
4. Run the same four-way macOS benchmark and separate physical Windows/Linux checks. Record event latency, GPU work and sustained load with OS instruments. Sign and test experimental artifacts, including updates and rollback. Re-run the paired corpora and DJ applications.
5. Complete the decision matrix with measured evidence and bring the result to review before merging any experiment.
