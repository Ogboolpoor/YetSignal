//! Spectral rate estimation for vital signs (FR-11 breathing, FR-12 heart).
//!
//! Scans a frequency band with a Goertzel-style DFT over a detrended, Hann-
//! windowed signal and returns the dominant frequency, its power and an SNR-like
//! confidence (peak power / mean band power).

use core::f32::consts::PI;

#[derive(Debug, Clone, Copy)]
pub struct RateEstimate {
    pub freq_hz: f32,
    pub bpm: f32,
    pub power: f32,
    pub snr: f32,
}

pub fn estimate_rate(
    buf: &[f32],
    fs: f32,
    f_lo: f32,
    f_hi: f32,
    step: f32,
) -> Option<RateEstimate> {
    let n = buf.len();
    if (n as f32) < fs * 4.0 {
        return None; // need a few seconds of data
    }

    // detrend (remove mean) + Hann window
    let mean = buf.iter().sum::<f32>() / n as f32;
    let mut w = vec![0.0f32; n];
    for i in 0..n {
        let hann = 0.5 - 0.5 * (2.0 * PI * i as f32 / (n as f32 - 1.0)).cos();
        w[i] = (buf[i] - mean) * hann;
    }

    let (mut best_f, mut best_p) = (0.0f32, f32::MIN);
    let mut powers: Vec<f32> = Vec::new();
    let mut f = f_lo;
    while f <= f_hi {
        let omega = 2.0 * PI * f / fs;
        let (mut re, mut im) = (0.0f32, 0.0f32);
        for i in 0..n {
            let a = omega * i as f32;
            re += w[i] * a.cos();
            im += w[i] * a.sin();
        }
        let p = re * re + im * im;
        powers.push(p);
        if p > best_p {
            best_p = p;
            best_f = f;
        }
        f += step;
    }
    // Confidence = peak / median band power: the median tracks the noise floor
    // and is robust to the peak and its main lobe, so a clean tone scores high.
    powers.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap());
    let med = powers[powers.len() / 2].max(1e-12);
    let snr = best_p / med;
    Some(RateEstimate {
        freq_hz: best_f,
        bpm: best_f * 60.0,
        power: best_p,
        snr,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::f32::consts::PI;

    #[test]
    fn recovers_breathing_frequency() {
        let fs = 25.0;
        let n = (fs * 16.0) as usize;
        // 15 bpm = 0.25 Hz respiration tone + noise
        let f_true = 0.25;
        let buf: Vec<f32> = (0..n)
            .map(|i| (2.0 * PI * f_true * i as f32 / fs).sin())
            .collect();
        let est = estimate_rate(&buf, fs, 0.12, 0.55, 0.01).unwrap();
        assert!((est.bpm - 15.0).abs() < 1.5, "got {} bpm", est.bpm);
        // SNR is peak/median band power; a clean tone sits far above the noise
        // floor (median), so this should be large.
        assert!(est.snr > 15.0, "snr too low: {}", est.snr);
    }
}
