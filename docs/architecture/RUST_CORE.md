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
