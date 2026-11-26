# Architecture benchmark results

## Electron desktop reference

Apple M5 arm64, macOS 27.2.1 (26B131), Electron 45.3.2 and Node 24.22.3. Production engine revision `a31211a41b5c016b5191eaccc4046183f25a55ad`; measurement commit `9e0f7c4`. Ten runs per population, all 50 successful. Each starts with a fresh profile seeded with synthetic records that refer to nonexistent files. OS cache state was uncontrolled. Development build. Values are per-run median / P95, except CPU below is median.

| Synthetic entries | Renderer-ready, ms | Idle RSS sum, MiB | Idle CPU, % | Raw |
|---:|---:|---:|---:|---|
| 0 | 362 / 388 | 453 / 462 | 0.129 | [JSON](raw/electron-macos-arm64-0.json) |
| 10 | 363 / 400 | 457 / 466 | 0.122 | [JSON](raw/electron-macos-arm64-10.json) |
| 100 | 360 / 433 | 475 / 476 | 0.125 | [JSON](raw/electron-macos-arm64-100.json) |
| 1,000 | 396 / 407 | 520 / 529 | 0.144 | [JSON](raw/electron-macos-arm64-1000.json) |
| 10,000 | 805 / 1,076 | 1,013 / 1,022 | 0.078 | [JSON](raw/electron-macos-arm64-10000.json) |

RSS is summed across Browser, Tab, Utility and GPU processes and may double-count shared pages. CPU is the sampled Electron process sum with its native reporting convention. Neither figure is a measurement of GPU hardware activity. No controlled cold OS start, input-to-present latency, GPU utilization, waveform frame times or peak memory through a large analysis batch were measured.

Local unpublished DMGs measured 238,574,810 bytes (arm64) and 254,647,229 bytes (x64). The extracted app bundles occupied 695,036 and 734,304 KiB in `du -sk` respectively. Signed ad hoc, with notarization skipped.

## Musical reference

- 74 unit tests passed. Synthetic end-to-end analysis and automated export/import cases passed.
- Electron smoke drained three rounds with zero renderer errors and two cache hits on reimport. The generated fixture returned false for three informational UI probes (`liveTempoSort`, `vocalEdited` and `transitionButton`). The smoke runner exited successfully.
- One rhythm run exited 1 when the UK garage synthetic cue was missing (131.64 BPM, −47.4 ms phase). Four subsequent runs recovered the cue about 0.00354 beats from its reference. Trap and hard techno downbeats were marked ambiguous/failing in the local table as historically documented. [One successful raw run](raw/electron-macos-arm64-rhythm.json).
- WAV, LAME MP3 and AAC detected the reference attack at 1.000 s. MP3 with no gapless header detected it at 1.025 s. Automated XML/NML round-trips preserved cue times. Traktor/Rekordbox were not rerun on this Mac.
- The official Ballroom annotation revision was verified. The larger paired corpus and listening evaluation remain pending. The historical MusiCNN measurements are in [0.6.0 validation](../ENGINE_VALIDATION_0.6.0.md).

## Comparison status

| Configuration | Verified workload | Comparative desktop metrics |
|---|---|---|
| Electron + current engine | Real app startup/idle, synthetic library and analysis validation | Apple M5 reference above |
| Electron + Rust | Existing app with an optional Rust waveform backend; paired waveform performance on four synthetic offset files | Equivalent desktop startup/idle and full-analysis comparison pending |
| Tauri + Rust | macOS native shell, loaded audio preview and playback | Equivalent workload pending |
| GPUI + Rust | macOS native shell and waveform prototype | Equivalent workload pending |

A paired waveform run (10 trials per file per implementation) observed identical bins for WAV, two MP3 encodings and AAC. The child-process Rust path took about 101–103 ms at the median versus 94–100 ms on the TypeScript path. This slice includes the same FFmpeg workload and extra process/JSON overhead. It is insufficient to infer whole-app or whole-engine performance.
