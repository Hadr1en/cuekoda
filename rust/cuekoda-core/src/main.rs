#![forbid(unsafe_code)]

use clap::{Parser, Subcommand};
use cuekoda_core::{
    Cancellation, Options, Peaks, TrackPreview, analyze_preview, compare_peaks, supported_file,
};
use serde_json::json;
use std::{
    fs,
    io::{self, BufReader, Write},
    path::{Path, PathBuf},
    sync::{Mutex, mpsc},
    thread,
    time::{Duration, Instant},
};

#[derive(Parser)]
struct Cli {
    #[arg(long, global = true, default_value = "ffmpeg")]
    ffmpeg: PathBuf,
    #[arg(long, global = true, default_value_t = 1800)]
    max_seconds: u32,
    #[arg(long, global = true, default_value_t = 60)]
    timeout_seconds: u64,
    #[arg(long, global = true, default_value_t = 200)]
    per_second: u32,
    #[command(subcommand)]
    operation: Operation,
}

#[derive(Subcommand)]
enum Operation {
    /// Write a versioned waveform and duration as JSON.
    Analyze { file: PathBuf },
    /// Analyze local files recursively and emit one JSON record per file.
    Batch {
        directory: PathBuf,
        #[arg(long, default_value_t = 2, value_parser = clap::value_parser!(u8).range(1..=8))]
        jobs: u8,
    },
    /// Measure repeated waveform extraction with a warm or uncontrolled OS cache.
    Benchmark {
        file: PathBuf,
        #[arg(long, default_value_t = 10, value_parser = clap::value_parser!(u8).range(1..=100))]
        runs: u8,
    },
    /// Run the existing musical algorithms through the local compatibility worker.
    Music { file: PathBuf },
    /// Stream mono f32le PCM and FFmpeg loudness diagnostics for the compatibility worker.
    Pcm {
        file: PathBuf,
        #[arg(long)]
        sample_rate: usize,
        #[arg(long)]
        left: bool,
    },
    /// Compare a legacy bare Peaks JSON file to a core Analyze response.
    Compare { legacy: PathBuf, rust: PathBuf },
}

fn main() -> std::process::ExitCode {
    let cli = Cli::parse();
    if let Operation::Pcm {
        file,
        sample_rate,
        left,
    } = &cli.operation
    {
        return match cuekoda_core::stream_pcm(&cli.ffmpeg, file, *sample_rate, *left) {
            Ok(status) => std::process::ExitCode::from(u8::try_from(status).unwrap_or(1)),
            Err(error) => {
                eprintln!("{error}");
                std::process::ExitCode::FAILURE
            }
        };
    }
    match run(cli) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            std::process::ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), Box<dyn std::error::Error>> {
    let cancellation = Cancellation::default();
    let signal = cancellation.clone();
    ctrlc::set_handler(move || signal.cancel())?;
    let options = Options {
        ffmpeg: cli.ffmpeg,
        max_duration_seconds: cli.max_seconds,
        timeout: Duration::from_secs(cli.timeout_seconds),
        peaks_per_second: cli.per_second,
    };
    let mut output = io::BufWriter::new(io::stdout().lock());
    match cli.operation {
        Operation::Pcm { .. } => unreachable!("PCM is handled before buffered JSON output"),
        Operation::Music { file } => {
            let analysis =
                cuekoda_core::music::Backend::from_environment()?.analyze(&file, &cancellation)?;
            write_json(&mut output, &analysis)?;
        }
        Operation::Analyze { file } => {
            let analysis = analyze_preview(&file, &options, &cancellation, |_| {})?;
            write_json(&mut output, &analysis)?;
        }
        Operation::Batch { directory, jobs } => {
            if !directory.is_dir() {
                return Err("expected a directory".into());
            }
            let mut paths = Vec::new();
            collect_files(&directory, &mut paths, &cancellation)?;
            paths.sort();
            let paths = Mutex::new(paths.into_iter());
            let failed = thread::scope(|scope| -> io::Result<bool> {
                let (sender, receiver) = mpsc::sync_channel(usize::from(jobs));
                for _ in 0..jobs {
                    let sender = sender.clone();
                    let (paths, options, cancellation) = (&paths, &options, &cancellation);
                    scope.spawn(move || {
                        while cancellation.check().is_ok() {
                            let Some(path) = paths.lock().expect("paths lock poisoned").next()
                            else {
                                break;
                            };
                            let result = analyze_preview(&path, options, cancellation, |_| {});
                            if sender.send((path, result)).is_err() {
                                break;
                            }
                        }
                    });
                }
                drop(sender);
                let mut failed = false;
                for (path, result) in receiver {
                    let entry = match result {
                        Ok(analysis) => json!({ "path": path, "analysis": analysis }),
                        Err(error) => {
                            failed = true;
                            json!({ "path": path, "error": error.to_string() })
                        }
                    };
                    write_json(&mut output, &entry)?;
                }
                Ok(failed)
            })?;
            output.flush()?;
            cancellation.check()?;
            if failed {
                return Err("at least one file failed".into());
            }
        }
        Operation::Benchmark { file, runs } => {
            let mut elapsed = Vec::with_capacity(usize::from(runs));
            for _ in 0..runs {
                let start = Instant::now();
                analyze_preview(&file, &options, &cancellation, |_| {})?;
                elapsed.push(start.elapsed().as_secs_f64() * 1000.0);
            }
            let mut sorted = elapsed.clone();
            sorted.sort_by(f64::total_cmp);
            let n = sorted.len();
            write_json(
                &mut output,
                &json!({
                    "runs_ms": elapsed,
                    "median_ms": (sorted[(n - 1) / 2] + sorted[n / 2]) / 2.0,
                    "p95_ms": sorted[(n * 95).div_ceil(100) - 1],
                    "os_cache": "uncontrolled",
                }),
            )?;
        }
        Operation::Compare { legacy, rust } => {
            let previous: Peaks = serde_json::from_reader(BufReader::new(fs::File::open(legacy)?))?;
            let current: TrackPreview =
                serde_json::from_reader(BufReader::new(fs::File::open(rust)?))?;
            let difference =
                compare_peaks(&previous, &current.waveform).ok_or("incompatible peak arrays")?;
            write_json(
                &mut output,
                &json!({ "bins": previous.peak.len(), "max_absolute_error": difference }),
            )?;
            output.flush()?;
            if difference > 0.001 + f64::EPSILON {
                return Err("difference exceeds one waveform quantization step".into());
            }
        }
    }
    output.flush()?;
    Ok(())
}

fn write_json(output: &mut impl Write, value: &impl serde::Serialize) -> io::Result<()> {
    serde_json::to_writer(&mut *output, value)?;
    writeln!(output)
}

fn collect_files(
    path: &Path,
    paths: &mut Vec<PathBuf>,
    cancellation: &Cancellation,
) -> Result<(), cuekoda_core::Error> {
    let mut pending = vec![path.to_owned()];
    while let Some(directory) = pending.pop() {
        cancellation.check()?;
        for entry in fs::read_dir(directory)? {
            cancellation.check()?;
            let entry = entry?;
            let kind = entry.file_type()?;
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file() && supported_file(&entry.path()) {
                paths.push(entry.path());
            }
        }
    }
    Ok(())
}
