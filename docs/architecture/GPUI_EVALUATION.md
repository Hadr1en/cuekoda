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
