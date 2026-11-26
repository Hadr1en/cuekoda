# Architecture benchmarking

Pin the production reference, all three Rust integrations to one exact core commit, and the toolchains, lockfiles, models and decoder. Record machine, OS, architecture, power mode and GPU driver. Use an SHA-256 manifest of legal audio, matching settings and independent copies of data. Alternate modes on the same machine. Report the median and nearest-rank P95 with raw samples, failure counts, and sample sizes. Keep distinct machines and CI results separate.

## Reproduce the Electron reference

```sh
npm ci
npm run typecheck
npm run test:unit
npm test
npm run smoke
npm run benchmark:rhythm -- --json /tmp/electron-rhythm.json
npm run offset-test
npm run corpora:verify -- ballroom /path/to/pinned/BallroomAnnotations
npm run build
node scripts/electron-desktop-benchmark.mjs /tmp/electron-1000.json 10 1000
npm run dist:mac -- --publish never
```

The desktop runner uses 0, 10, 100, 1,000 and 10,000 synthetic missing tracks in v2 library indexes. They measure initial library UI cost and filesystem misses. Real audio loading, playback, analysis and saved results have separate workloads. The hook uses a distinct profile for each launch and waits for renderer boot and an animation frame. The marker is a renderer-side readiness proxy. OS cache was uncontrolled. The first sample was taken 250 ms after readiness and the idle summary used samples from 1.0 to 2.25 seconds. The script is applicable to development builds on macOS/Windows/Linux with a real graphical session and the Electron runtime installed. Linux and Windows measurements are pending.

The renderer probe emits Electron's registered process IDs, CPU time and utilization every 250 ms. On Unix the runner looks up RSS for those PIDs using `ps`. On Windows it uses the per-process working set. RSS sums can count shared pages multiple times. Null is used when a process's data is unavailable. Peaks during startup can precede the first sample. This runner does not measure a peak process-tree footprint across analysis subprocesses, GPU hardware utilization, or input-to-present latency.

## Required equivalent desktop runs

- Measure genuinely cold OS starts after a documented cache reset and warm starts after a controlled quit. Compare application-cache cold and warm analysis independently.
- Run at least ten launches, single-file and batch trials. Use at least 30 interactions where practical. Compare 10/100/1,000 tracks, and 10,000 items in a library fixture. Use equivalent app functionality and the same CPU/concurrency settings.
- Record complete process-tree resource traces. Include FFmpeg and ONNX children, GPU and WebView helper processes, identifying helper ownership where the operating system reparents them. Use platform performance instrumentation for GPU utilization, frame presentation and input-to-present timing.
- Measure idle, sustained load, playback/scrub/zoom and UI interactions during mass analysis. Record dropped frames, frame time percentiles, CPU time and maximum, peak memory and stability.
- Compare installed and compressed installer bytes separately, including whether a system runtime is shared. Linux/Windows CI is suitable for compilation and deterministic tests. GPU and interactive experience need representative physical systems.

The generic `scripts/architecture-benchmark.mjs` records command wall time only. The experiment/Electron branch adds a paired waveform harness with identical FFmpeg input and alternating order. See [decision gates](../architecture/DECISION.md) for musical equivalence.

## Four-way desktop preparation workload

Build the original Electron app in the benchmark checkout. Build the Electron/Rust JS bundles in the Electron experiment checkout, the Tauri frontend and debug app, and the GPUI debug app in their own checkouts. Build the shared worker with `npm run build` and the shared decoder with `cargo build --release --locked --manifest-path rust/cuekoda-core/Cargo.toml` in the core checkout. On macOS, run from the benchmark checkout:

```sh
node scripts/prepare-desktop-benchmark.mjs /path/to/fixture.wav /tmp/prepare.json 10 /path/to/core /path/to/electron-rust /path/to/tauri /path/to/gpui
```

The benchmark rotates application order and uses a fresh experiment data directory per run. A result is usable when the renderer has analyzed an imported track, loaded the detailed peaks and requested the next frame. All four apps report BPM, key, cue count and section count. A mismatch or missing signal fails the workload. GPU presentation, input latency, full process-tree CPU/RAM and application stability need separate probes. A platform build includes no claim about physical desktop performance.

To measure the existing Electron renderer's opt-in virtualizer, use `CUEKODA_VIRTUAL_LIBRARY=1 node scripts/electron-desktop-benchmark.mjs /tmp/virtual.json 10 10000` after building. Use `CUEKODA_VIRTUAL_LIBRARY=0` for the same fixture with all rows mounted. With virtualization on, an additional run using `CUEKODA_VIRTUAL_CHECK=1` verifies the last row and keyboard selection at the lower viewport boundary. Keep it separate from timing runs.
