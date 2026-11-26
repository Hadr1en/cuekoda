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

The current local DJ references matched three files. All three BPM estimates were within 1% (zero octave errors), with a median grid phase error of 2.1 ms on the two labelled tracks and cue recall of 67% within ±40 ms and matching type. The labelled set contains no keys, beat sequences, sections or vocal intervals. Per-track audio and paths stayed local. [Aggregate JSON](raw/electron-macos-arm64-local-evaluation.json)

The [Tauri virtualization trial](https://github.com/Hadr1en/cuekoda/blob/archive/tauri-experiment/docs/architecture/TAURI_EVALUATION.md#virtualized-library-measurement) directly compares the same DOM path with and without virtualization. At 10,000 synthetic rows, median DOM and forced layout work fell from 58 ms to 0.5 ms, with 28 mounted rows. This isolates virtualization within that prototype. A same-feature Electron-versus-Tauri comparison needs its own paired benchmark.

## Four-way musical preparation on macOS

The same synthetic WAV was added in each desktop application and passed through the musical analyzer and detailed waveform path. Forty independent launches completed. Every run reported 120 BPM, Camelot 11A, two cues and four sections. The measurement starts at process launch and ends when the UI reports both results and submits a frame. All runs used fresh application data and an uncontrolled OS cache. Electron used its development runtime; native shells used debug wrappers and a release Rust decoder with the same worker/models. The samples do not isolate a framework, model warm-up, disk cache or GPU factor.

| Desktop mode | Median, ms | P95, ms |
|---|---:|---:|
| Electron, original decoder | 2,033 | 2,239 |
| Electron, Rust decoder | 2,045 | 2,298 |
| Tauri, Rust decoder | 2,101 | 2,299 |
| GPUI, Rust decoder | 1,929 | 1,976 |

[Forty raw observations](raw/desktop-prepare-macos-arm64.json). The largest median difference was 172 ms in this short workload. Treat this as a result for the specific implementations and workload. It does not establish whole-app speed, resource use or musical parity across a full library.

The paired codec check compared all musical analysis fields (excluding generated IDs and runtime), and serialized XML, NML and M3U8 outputs (excluding Traktor's playlist timestamp), on WAV, LAME MP3, non-gapless MP3 and AAC. It also checked that manual cues survived reanalysis and locked XML/NML round trips. On three local DJ references, the two decoders yielded identical evaluation summaries: 100% BPM within 1%, 2.1 ms median grid phase where annotated and 67% cue recall at ±40 ms. [Paired aggregate](raw/paired-decoder-local-evaluation.json).

The same four-way test repeated on AAC. All forty runs agreed on 120 BPM, 11A, one cue and four sections.

| Desktop mode | AAC median, ms | AAC P95, ms |
|---|---:|---:|
| Electron, original decoder | 2,036 | 2,339 |
| Electron, Rust decoder | 2,082 | 2,263 |
| Tauri, Rust decoder | 2,109 | 2,291 |
| GPUI, Rust decoder | 1,955 | 2,095 |

[Forty AAC raw observations](raw/desktop-prepare-aac-macos-arm64.json).

## Electron list virtualization

The experiment's opt-in virtualizer was tested in the existing Electron renderer with the same 10,000 synthetic missing audio records. Ten independent launches per mode used isolated application profiles.

| Renderer mode | Ready med/P95, ms | Idle aggregate RSS med/P95, MiB |
|---|---:|---:|
| Full table | 987 / 1,086 | 1,003 / 1,004 |
| Virtualized | 455 / 470 | 497 / 498 |

The median idle RSS sum fell 50.5% and renderer readiness fell 53.9% in this workload. An additional check mounted 31 rows at the top and bottom, verified the last row's accessibility index (10,000 tracks), and selected the preceding row using Arrow Up. Adoption requires testing screen readers, real results and multi-selection at scale. [Full-table samples](raw/electron-library-full-macos-arm64.json) · [Virtualized samples](raw/electron-library-virtual-macos-arm64.json).
