# GPUI native experiment

Core revision `147a2cfa656e254f2dea792c3c67cc47bf5dcad8`. The application uses GPUI 0.2.2 (Apache-2.0) with embedded Metal shader source compiled at runtime on macOS, and Rodio for native playback. The implemented path scans and imports selected files, folders and OS drops; the library uses a GPUI uniform list, sort, search and arrow navigation. The waveform is painted by GPUI over GPU quads with zoom, panning, click seek and playhead. Preview data includes basic tags. The job runs in a background executor and provides progress and cancellation. Number keys set and revisit session cue slots, with Shift to replace a cue. It has light and dark palettes.

```sh
cargo build --locked --manifest-path rust/cuekoda-gpui/Cargo.toml
CUEKODA_EXPERIMENT_FFMPEG=/absolute/path/to/ffmpeg \
  rust/cuekoda-gpui/target/debug/cuekoda-gpui /path/to/track.wav
CUEKODA_EXPERIMENT_FFMPEG=/absolute/path/to/ffmpeg \
  rust/cuekoda-gpui/target/debug/cuekoda-gpui --analysis-smoke /path/to/track.wav
```

The local macOS ARM64 build launched successfully and the graphical smoke produced a real waveform from the synthetic WAV. Compile-time Metal tooling was unavailable in the local Command Line Tools and the published GPUI runtime-shader feature allowed the native build. The `agent-desktop` accessibility tree showed the title and native window buttons, with the music-library controls absent. That result is an accessibility gap for this pinned GPUI release and prototype. Test the upstream accessibility APIs before expanding the native UI. GPUI 0.2.2 declares Linux and Windows backends. This experiment still needs physical verification there, along with audio output, media seeks, drag-and-drop, cues, multi-monitor/HiDPI, presentation timing and GPU load. [GPUI API](https://docs.rs/gpui/0.2.2/gpui/) · [Upstream GPUI source](https://github.com/zed-industries/zed/tree/main/crates/gpui)

The library and cue edits are session-only. Engine features such as BPM, beatgrids, sections, automatic cues and interoperability are not ported. French UI strings need proper i18n integration. Zed continues to evolve GPUI before 1.0, with platform composition differing between the published crate and upstream main. Linux and Windows CI artifacts are useful for build validation. Updater integration, installers, OS code signing and notarization remain open. No WebView or HTML is used by the GPUI prototype.

The initial Linux CI build failed in the published GPUI dependency graph. Its `zed-async-tar` pulls `xattr` 0.2.3, which uses a libc alias removed in the latest Linux release. The experiment lockfile holds libc at 0.2.189 and Mio at 1.2.4 while GPUI 0.2.2 is pinned. This does not require a GPUI fork. Recheck the pin before upgrading. [Upstream libc issue](https://github.com/rust-lang/libc/issues/1356)

A muted Apple Silicon hardware smoke also passed: the native Rodio output advanced the playhead, sought to two seconds in the synthetic WAV, and paused. Reproduce on a machine with audio output:

```sh
CUEKODA_TEST_AUDIO=/absolute/path/to/synthetic.wav \
  cargo test --locked --manifest-path rust/cuekoda-gpui/Cargo.toml \
  native_output_advances_and_seeks -- --ignored
```

## Musical preparation

The native GPUI window now displays BPM, key, a variable beatgrid, section boundaries and cue markers. Number keys recall or place cues, and Shift plus a number updates the corresponding unlocked cue. Musical edits are stored in the GPUI experiment profile and applied on reanalysis. It reads local M3U8 paths, imports the selected track's XML/NML cue data and exports Rekordbox XML, Traktor NML and M3U8 for the selected track.

The GPUI artifact includes the separate shared Rust decoder, local compatibility worker and models. With Node installed, run `npm ci --omit=dev` in the artifact directory, then `node scripts/launch-native-experiment.mjs bin/cuekoda-gpui` (use `bin/cuekoda-gpui.exe` on Windows). The benchmark uses the native UI and Rodio path with the existing musical algorithms supplied by the companion process. The GPUI application itself uses a native renderer. Bulk workflows, accessibility, physical platform checks and the updater remain open.
