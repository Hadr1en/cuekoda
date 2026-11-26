use crate::{Cancellation, Error, SAMPLE_RATE};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peaks {
    pub per_sec: u32,
    pub peak: Vec<f64>,
    pub low: Vec<f64>,
    pub mid: Vec<f64>,
    pub high: Vec<f64>,
}

pub fn peaks(samples: &[f32], per_sec: u32, cancellation: &Cancellation) -> Result<Peaks, Error> {
    let sr = SAMPLE_RATE as f64;
    let step = sr / f64::from(per_sec);
    let bins = (samples.len() as f64 / step).floor() as usize;
    let length = (bins as f64 * step).round() as usize;
    let bin_size = length as f64 / bins as f64;
    let a_low = (-std::f64::consts::TAU * 150.0 / sr).exp();
    let a_high = (-std::f64::consts::TAU * 2500.0 / sr).exp();
    let mut low_pass = 0.0;
    let mut mid_pass = 0.0;
    let mut maximum = 1e-9_f64;
    let mut out = Peaks {
        per_sec,
        peak: Vec::with_capacity(bins),
        low: Vec::with_capacity(bins),
        mid: Vec::with_capacity(bins),
        high: Vec::with_capacity(bins),
    };
    for bin in 0..bins {
        if bin % 128 == 0 {
            cancellation.check()?;
        }
        let start = (bin as f64 * bin_size).floor() as usize;
        let end = (((bin + 1) as f64 * bin_size).floor() as usize).min(length);
        let (mut peak, mut low, mut mid, mut high) = (0.0_f64, 0.0_f64, 0.0_f64, 0.0_f64);
        for &sample in &samples[start..end] {
            let sample = f64::from(sample);
            low_pass = a_low * low_pass + (1.0 - a_low) * sample;
            mid_pass = a_high * mid_pass + (1.0 - a_high) * sample;
            peak = peak.max(sample.abs());
            low = low.max(low_pass.abs());
            mid = mid.max((mid_pass - low_pass).abs());
            high = high.max((sample - mid_pass).abs());
        }
        maximum = maximum.max(peak);
        out.peak.push(peak);
        out.low.push(low);
        out.mid.push(mid);
        out.high.push(high);
    }
    for band in [&mut out.peak, &mut out.low, &mut out.mid, &mut out.high] {
        for value in band {
            *value = ((*value / maximum).min(1.0) * 1000.0).round() / 1000.0;
        }
    }
    Ok(out)
}

/// Returns the greatest per-bin difference for compatible waveform shapes.
pub fn compare_peaks(left: &Peaks, right: &Peaks) -> Option<f64> {
    if left.per_sec != right.per_sec {
        return None;
    }
    let mut maximum = 0.0_f64;
    for (a, b) in [
        (&left.peak, &right.peak),
        (&left.low, &right.low),
        (&left.mid, &right.mid),
        (&left.high, &right.high),
    ] {
        if a.len() != left.peak.len() || b.len() != left.peak.len() {
            return None;
        }
        for (a, b) in a.iter().zip(b) {
            if !a.is_finite() || !b.is_finite() {
                return None;
            }
            maximum = maximum.max((a - b).abs());
        }
    }
    Some(maximum)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_has_zero_peaks_and_incompatible_shapes_are_rejected() {
        let samples = vec![0.0; SAMPLE_RATE];
        let a = peaks(&samples, 200, &Cancellation::default()).unwrap();
        let b = peaks(&samples, 100, &Cancellation::default()).unwrap();
        assert_eq!(a.peak, vec![0.0; 200]);
        assert_eq!(a.low, a.peak);
        assert_eq!(a.mid, a.peak);
        assert_eq!(a.high, a.peak);
        assert_eq!(compare_peaks(&a, &b), None);
    }
}
