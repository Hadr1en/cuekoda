#![forbid(unsafe_code)]

mod decode;
mod metadata;
mod waveform;

use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

pub use metadata::Metadata;
pub use waveform::{Peaks, compare_peaks};

pub const SCHEMA_VERSION: u32 = 1;
pub const SAMPLE_RATE: usize = 22_050;
pub const MAX_DURATION_SECONDS: u32 = 1_800;
pub const AUDIO_EXTENSIONS: &[&str] = &[
    "aac", "aif", "aiff", "alac", "flac", "m4a", "mp3", "ogg", "opus", "wav", "wma",
];

#[derive(Clone, Default)]
pub struct Cancellation(Arc<AtomicBool>);

impl Cancellation {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Relaxed);
    }

    pub fn check(&self) -> Result<(), Error> {
        if self.0.load(Ordering::Relaxed) {
            return Err(Error::Cancelled);
        }
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("analysis cancelled")]
    Cancelled,
    #[error("analysis timed out")]
    Timeout,
    #[error("expected a local regular audio file")]
    InvalidInput,
    #[error("invalid duration, timeout or waveform rate")]
    InvalidLimits,
    #[error("audio is shorter than five seconds")]
    TooShort,
    #[error("audio is longer than the configured limit")]
    TooLong,
    #[error("decoder exited with {0}")]
    Decode(std::process::ExitStatus),
    #[error("invalid float32 PCM from decoder")]
    InvalidPcm,
    #[error("decoder I/O: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Clone)]
pub struct Options {
    pub ffmpeg: PathBuf,
    pub max_duration_seconds: u32,
    pub timeout: Duration,
    pub peaks_per_second: u32,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            ffmpeg: "ffmpeg".into(),
            max_duration_seconds: MAX_DURATION_SECONDS,
            timeout: Duration::from_secs(60),
            peaks_per_second: 200,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum Stage {
    Decoding,
    Waveform,
    Complete,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackPreview {
    pub schema_version: u32,
    pub duration_sec: f64,
    pub sample_rate: usize,
    pub waveform: Peaks,
    pub metadata: Metadata,
}

pub fn supported_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            AUDIO_EXTENSIONS
                .iter()
                .any(|ext| value.eq_ignore_ascii_case(ext))
        })
}

pub fn analyze_preview(
    path: &Path,
    options: &Options,
    cancellation: &Cancellation,
    mut progress: impl FnMut(Stage),
) -> Result<TrackPreview, Error> {
    cancellation.check()?;
    if !(5..=MAX_DURATION_SECONDS).contains(&options.max_duration_seconds)
        || !(1..=400).contains(&options.peaks_per_second)
        || options.timeout.is_zero()
    {
        return Err(Error::InvalidLimits);
    }
    let path = path.canonicalize()?;
    if !path.is_file() || !supported_file(&path) {
        return Err(Error::InvalidInput);
    }
    progress(Stage::Decoding);
    let samples = decode::decode(&path, options, cancellation)?;
    progress(Stage::Waveform);
    let waveform = waveform::peaks(&samples, options.peaks_per_second, cancellation)?;
    cancellation.check()?;
    let metadata = metadata::read(&path);
    cancellation.check()?;
    progress(Stage::Complete);
    Ok(TrackPreview {
        schema_version: SCHEMA_VERSION,
        duration_sec: samples.len() as f64 / SAMPLE_RATE as f64,
        sample_rate: SAMPLE_RATE,
        waveform,
        metadata,
    })
}
