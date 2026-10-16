//! FR-06 — Hampel filter: outlier rejection by Median Absolute Deviation (MAD).
//!
//! For each sample we examine a window of `half_win` neighbours on each side,
//! compute the median and the MAD, and replace the sample by the median when it
//! deviates by more than `n_sigma` scaled MADs. The 1.4826 factor makes MAD a
//! consistent estimator of the standard deviation for Gaussian data. When the
//! window is (near-)flat the MAD collapses to ~0, so we fall back to the mean
//! absolute deviation to still reject isolated impulses.

const MAD_SCALE: f32 = 1.4826;

#[inline]
fn median(buf: &mut [f32]) -> f32 {
    buf.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap());
    let n = buf.len();
    if n == 0 {
        0.0
    } else if n % 2 == 1 {
        buf[n / 2]
    } else {
        0.5 * (buf[n / 2 - 1] + buf[n / 2])
    }
}

/// In-place Hampel filter over a 1-D series (e.g. amplitude across subcarriers).
pub fn hampel(x: &mut [f32], half_win: usize, n_sigma: f32) {
    let n = x.len();
    if n == 0 {
        return;
    }
    let src: Vec<f32> = x.to_vec();
    let mut win: Vec<f32> = Vec::with_capacity(2 * half_win + 1);
    for i in 0..n {
        let lo = i.saturating_sub(half_win);
        let hi = (i + half_win).min(n - 1);
        win.clear();
        win.extend_from_slice(&src[lo..=hi]);
        let med = median(&mut win);

        // deviations from the median
        let mut devs: Vec<f32> = win.iter().map(|v| (v - med).abs()).collect();
        let mad = MAD_SCALE * median(&mut devs);
        let scale = if mad > 1e-6 {
            mad
        } else {
            let mean_abs = devs.iter().sum::<f32>() / devs.len() as f32;
            MAD_SCALE * mean_abs
        };
        if scale > 1e-9 && (src[i] - med).abs() > n_sigma * scale {
            x[i] = med;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_isolated_spike() {
        let mut x = vec![10.0, 10.1, 9.9, 10.0, 25.0, 10.1, 9.8, 10.0];
        hampel(&mut x, 3, 3.0);
        assert!((x[4] - 10.0).abs() < 1.0, "spike not removed: {}", x[4]);
    }

    #[test]
    fn keeps_clean_signal() {
        let mut x: Vec<f32> = (0..32).map(|k| (k as f32 * 0.2).sin()).collect();
        let orig = x.clone();
        hampel(&mut x, 3, 3.0);
        for (a, b) in x.iter().zip(orig.iter()) {
            assert!((a - b).abs() < 1e-3);
        }
    }
}
