use crate::{Cancellation, Error, Options, SAMPLE_RATE};
use std::{
    io::{BufReader, Read},
    path::Path,
    process::{Command, Stdio},
    sync::mpsc::{self, RecvTimeoutError},
    thread,
    time::{Duration, Instant},
};

fn pcm_command(ffmpeg: &Path, path: &Path, rate: usize, left: bool, log: &str) -> Command {
    let mut command = Command::new(ffmpeg);
    let filter = if left {
        "ebur128=peak=true:framelog=quiet,pan=mono|c0=c0"
    } else {
        "ebur128=peak=true:framelog=quiet"
    };
    command
        .args([
            "-hide_banner",
            "-nostats",
            "-v",
            log,
            "-nostdin",
            "-filter_threads",
            "1",
            "-threads:a",
            "1",
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            "aac,aiff,asf,flac,mov,mp3,ogg,wav",
            "-i",
        ])
        .arg(path)
        .args(["-vn", "-af", filter, "-ac", "1", "-ar"])
        .arg(rate.to_string())
        .args(["-f", "f32le", "pipe:1"])
        .stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    command
}

/// Write unbuffered FFmpeg PCM and its original loudness diagnostics to stdout/stderr.
/// The host consumes the stream and applies its existing byte and duration bounds.
pub fn stream_pcm(ffmpeg: &Path, path: &Path, rate: usize, left: bool) -> Result<i32, Error> {
    if !(8_000..=192_000).contains(&rate) {
        return Err(Error::InvalidLimits);
    }
    let path = path.canonicalize()?;
    if !path.is_file() || !crate::supported_file(&path) {
        return Err(Error::InvalidInput);
    }
    let status = pcm_command(ffmpeg, &path, rate, left, "info").status()?;
    Ok(status.code().unwrap_or(1))
}

pub fn decode(
    path: &Path,
    options: &Options,
    cancellation: &Cancellation,
) -> Result<Vec<f32>, Error> {
    let mut child = pcm_command(&options.ffmpeg, path, SAMPLE_RATE, false, "error")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let stdout = child.stdout.take().expect("stdout is piped");
    let max_samples = SAMPLE_RATE * options.max_duration_seconds as usize;
    let (send, receive) = mpsc::sync_channel(1);
    let reader = match thread::Builder::new().spawn(move || {
        let _ = send.send(read_pcm(stdout, max_samples));
    }) {
        Ok(reader) => reader,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error.into());
        }
    };
    let started = Instant::now();
    let result = (|| {
        let mut samples = None;
        let mut exit = None;
        loop {
            cancellation.check()?;
            if started.elapsed() >= options.timeout {
                return Err(Error::Timeout);
            }
            if exit.is_none() {
                exit = child.try_wait()?;
            }
            if let (Some(status), Some(_)) = (exit, &samples) {
                return if status.success() {
                    Ok(samples.expect("PCM received"))
                } else {
                    Err(Error::Decode(status))
                };
            }
            if samples.is_some() {
                thread::sleep(Duration::from_millis(10));
            } else {
                match receive.recv_timeout(Duration::from_millis(10)) {
                    Ok(result) => samples = Some(result?),
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => return Err(Error::InvalidPcm),
                }
            }
        }
    })();
    if result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let _ = reader.join();
    let samples = result?;
    if samples.len() < 5 * SAMPLE_RATE {
        return Err(Error::TooShort);
    }
    Ok(samples)
}

fn read_pcm(stdout: impl Read, max_samples: usize) -> Result<Vec<f32>, Error> {
    let mut reader = BufReader::with_capacity(32 * 1024, stdout);
    let mut samples = Vec::new();
    let mut value = [0; 4];
    while reader.read(&mut value[..1])? != 0 {
        reader.read_exact(&mut value[1..])?;
        if samples.len() == max_samples {
            return Err(Error::TooLong);
        }
        let value = f32::from_le_bytes(value);
        if !value.is_finite() {
            return Err(Error::InvalidPcm);
        }
        samples.push(value);
    }
    Ok(samples)
}
