# CueKoda Core

The first shared Rust component generates the existing four-band waveform payload and reads basic tags. The versioned preview envelope adds `schemaVersion`, `durationSec`, `sampleRate` and `metadata`. This envelope has its own schema and is independent of the Electron library or `AnalysisResult` format.

FFmpeg still decodes mono PCM at 22.05 kHz using the same downmix, resampling and filter chain as the existing waveform path. The Rust port keeps the existing filter coefficients, bin boundaries, normalization and three-decimal quantization. Lofty reads tags with cover art and property parsing disabled. Sources are opened read-only. Inputs are restricted to local regular files, supported extensions and an FFmpeg demuxer/protocol allowlist. A job has a 30-minute duration ceiling, a 60-second decoder timeout by default and cooperative cancellation. PCM is held in memory, so the permitted batch concurrency is capped at eight. This ceiling needs profiling before large-batch rollout.

```sh
cargo build --release --locked --manifest-path rust/cuekoda-core/Cargo.toml
rust/cuekoda-core/target/release/cuekoda-core --ffmpeg /path/to/ffmpeg analyze track.wav > preview.json
rust/cuekoda-core/target/release/cuekoda-core --ffmpeg /path/to/ffmpeg batch /path/to/tracks --jobs 2 > previews.jsonl
rust/cuekoda-core/target/release/cuekoda-core --ffmpeg /path/to/ffmpeg benchmark track.wav --runs 10
rust/cuekoda-core/target/release/cuekoda-core compare legacy-peaks.json preview.json
```

A failed batch still writes a JSON record for each attempted input and exits with status 1. Results arrive in completion order. The comparison gate allows one waveform quantization step (0.001). It says nothing about tempo, loudness, key, beatgrids, structure, vocals, cue selection, loops, transitions or export parity. These remain in the TypeScript engine.

FFmpeg preserves the waveform time base while avoiding a decoder change in the first experiment. [Symphonia](https://github.com/pdeljanov/Symphonia) is an MPL-2.0 candidate for a separately measured decoder. [Lofty](https://docs.rs/lofty/0.25.5/lofty/) is used for read-only tags. [RustFFT](https://github.com/ejmahler/RustFFT) and [RealFFT](https://github.com/HEnquist/realfft) become relevant when porting spectral analysis. [Rayon](https://github.com/rayon-rs/rayon) becomes relevant when measuring CPU scheduling beyond the bounded CLI queue. [CPAL](https://github.com/RustAudio/cpal) and [Rodio](https://github.com/RustAudio/rodio) are candidates for native playback. [NAPI-RS](https://github.com/napi-rs/napi-rs) and [ort](https://github.com/pykeio/ort) remain candidates for in-process Electron and Rust inference, respectively. Public reproducible benchmarks for CueKoda workloads are still required before a dependency switch.

## Musical compatibility path

The `pcm` subcommand starts the same FFmpeg executable and streams PCM and EBU R128 diagnostics. The existing TypeScript analyzer consumes those streams using its current duration and error logic. The renderer experiments invoke the shared Rust backend, which supervises a local Node worker containing the original musical algorithms and format adapters. Thus the audio I/O path passes through Rust while model inference, rhythm, key, structure and DJ formats still reuse the established engine. Node, npm dependencies and the bundled model files are required for this mode.

The request protocol uses a private temporary directory, bounded JSON, versioned responses and an explicit cancellation token. Experiment analysis and edited cues use independent user data. Reanalysis merges manual changes when the file content hash matches. The app adapters export Rekordbox XML, Traktor NML and M3U8 and import the selected track's XML/NML cues and loops through the existing collection functions.

```sh
npm ci
npm run offset-test
cargo build --release --locked --manifest-path rust/cuekoda-core/Cargo.toml
node scripts/test-experiment-music.mjs rust/cuekoda-core/target/release/cuekoda-core \
  cuekoda-offset-test/*.wav cuekoda-offset-test/*.mp3 cuekoda-offset-test/*.m4a
```

The parity check removes generated IDs and elapsed analysis time from JSON, and the playlist timestamp from Traktor NML. All remaining fields are compared. This catches differences in grid, key, cues, dynamics, vocals, sections and waveform values without treating nondeterministic identifiers as music changes.
