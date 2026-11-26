use cuekoda_core::{
    Cancellation, Error, Options, SAMPLE_RATE, Stage, analyze_preview, compare_peaks,
};
use std::{fs, path::Path, time::Duration};

fn fixture(path: &Path, seconds: usize) {
    let size = (SAMPLE_RATE * seconds * 2) as u32;
    let mut wav = Vec::new();
    wav.extend(b"RIFF");
    wav.extend((36 + size).to_le_bytes());
    wav.extend(b"WAVEfmt ");
    wav.extend(16_u32.to_le_bytes());
    wav.extend(1_u16.to_le_bytes());
    wav.extend(1_u16.to_le_bytes());
    wav.extend((SAMPLE_RATE as u32).to_le_bytes());
    wav.extend((SAMPLE_RATE as u32 * 2).to_le_bytes());
    wav.extend(2_u16.to_le_bytes());
    wav.extend(16_u16.to_le_bytes());
    wav.extend(b"data");
    wav.extend(size.to_le_bytes());
    for i in 0..(SAMPLE_RATE * seconds) {
        let phase = i as f64 * std::f64::consts::TAU * 440.0 / SAMPLE_RATE as f64;
        wav.extend(((phase.sin() * 30000.0) as i16).to_le_bytes());
    }
    fs::write(path, wav).unwrap();
}

fn options() -> Options {
    Options {
        ffmpeg: std::env::var_os("CUEKODA_TEST_FFMPEG")
            .unwrap_or_else(|| "ffmpeg".into())
            .into(),
        ..Options::default()
    }
}

#[test]
fn extracts_and_serializes_waveform_without_modifying_input() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tone.wav");
    fixture(&path, 6);
    let original = fs::read(&path).unwrap();
    let mut stages = Vec::new();
    let preview = analyze_preview(&path, &options(), &Cancellation::default(), |stage| {
        stages.push(stage)
    })
    .unwrap();
    assert!(matches!(
        stages.as_slice(),
        [Stage::Decoding, Stage::Waveform, Stage::Complete]
    ));
    assert_eq!(preview.duration_sec, 6.0);
    assert_eq!(preview.waveform.peak.len(), 1200);
    assert!(preview.waveform.peak.contains(&1.0));
    assert_eq!(
        compare_peaks(&preview.waveform, &preview.waveform),
        Some(0.0)
    );
    assert_eq!(fs::read(&path).unwrap(), original);
    let json = serde_json::to_value(preview).unwrap();
    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["waveform"]["perSec"], 200);
}

#[test]
fn rejects_invalid_audio_and_bounds() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("invalid.wav");
    fs::write(&path, b"incorrect WAV header").unwrap();
    let cancellation = Cancellation::default();
    assert!(matches!(
        analyze_preview(&path, &options(), &cancellation, |_| {}),
        Err(Error::Decode(_))
    ));
    fixture(&path, 4);
    assert!(matches!(
        analyze_preview(&path, &options(), &cancellation, |_| {}),
        Err(Error::TooShort)
    ));
    fixture(&path, 6);
    let constrained = Options {
        max_duration_seconds: 5,
        ..options()
    };
    assert!(matches!(
        analyze_preview(&path, &constrained, &cancellation, |_| {}),
        Err(Error::TooLong)
    ));
    fixture(&path, 5);
    assert!(analyze_preview(&path, &constrained, &cancellation, |_| {}).is_ok());
}

#[test]
fn cancels_and_applies_timeout() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tone.wav");
    fixture(&path, 6);
    let cancellation = Cancellation::default();
    assert!(matches!(
        analyze_preview(&path, &options(), &cancellation, |_| cancellation.cancel()),
        Err(Error::Cancelled)
    ));
    assert!(matches!(
        analyze_preview(&path, &options(), &cancellation, |_| panic!()),
        Err(Error::Cancelled)
    ));
    let constrained = Options {
        timeout: Duration::from_nanos(1),
        ..options()
    };
    assert!(matches!(
        analyze_preview(&path, &constrained, &Cancellation::default(), |_| {}),
        Err(Error::Timeout)
    ));
}
