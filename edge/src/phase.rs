//! FR-07 — SpotFi-style phase sanitisation.
//!
//! Raw CSI phase is corrupted by Sampling Time Offset and Carrier Frequency
//! Offset, which add a term approximately linear in the subcarrier index plus a
//! constant. SpotFi removes this by fitting a line to the unwrapped phase across
//! subcarriers and subtracting it, leaving propagation-induced phase:
//!     φ̂_k = φ_k − (a·k + b)

use core::f32::consts::PI;

/// Unwrap phase so successive differences stay within (−π, π].
pub fn unwrap(phase: &[f32], out: &mut [f32]) {
    let n = phase.len();
    if n == 0 {
        return;
    }
    out[0] = phase[0];
    let mut prev = phase[0];
    let mut acc = 0.0f32;
    for i in 1..n {
        let mut d = phase[i] - prev;
        while d > PI {
            d -= 2.0 * PI;
        }
        while d < -PI {
            d += 2.0 * PI;
        }
        acc += d;
        out[i] = phase[0] + acc;
        prev = phase[i];
    }
}

/// Remove the linear (STO/CFO) trend across subcarriers from raw I/Q.
/// Writes sanitised phase into `out`.
pub fn sanitise_phase(re: &[f32], im: &[f32], out: &mut [f32]) {
    let n = re.len();
    if n == 0 {
        return;
    }
    let mut raw = vec![0.0f32; n];
    for k in 0..n {
        raw[k] = im[k].atan2(re[k]);
    }
    let mut uw = vec![0.0f32; n];
    unwrap(&raw, &mut uw);

    // least-squares fit φ ≈ a·k + b over k = 0..n-1
    let (mut sx, mut sy, mut sxx, mut sxy) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
    for k in 0..n {
        let kf = k as f32;
        sx += kf;
        sy += uw[k];
        sxx += kf * kf;
        sxy += kf * uw[k];
    }
    let nf = n as f32;
    let denom = nf * sxx - sx * sx;
    let a = if denom != 0.0 {
        (nf * sxy - sx * sy) / denom
    } else {
        0.0
    };
    let b = (sy - a * sx) / nf;
    for k in 0..n {
        out[k] = uw[k] - (a * k as f32 + b);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::f32::consts::PI;

    #[test]
    fn removes_linear_trend() {
        // Construct I/Q whose phase is a pure linear ramp + constant.
        let n = 56;
        let (mut re, mut im) = (vec![0.0f32; n], vec![0.0f32; n]);
        for k in 0..n {
            let ph = 0.3 * k as f32 + 0.7;
            re[k] = ph.cos();
            im[k] = ph.sin();
        }
        let mut out = vec![0.0f32; n];
        sanitise_phase(&re, &im, &mut out);
        // a pure linear+constant phase should be flattened to ~0
        for v in &out {
            assert!(v.abs() < 1e-2, "residual too large: {}", v);
        }
    }

    #[test]
    fn unwrap_handles_wraps() {
        let phase = [3.0, -3.0, 3.0]; // wraps around ±π
        let mut out = [0.0f32; 3];
        unwrap(&phase, &mut out);
        // differences should be small after unwrapping
        assert!((out[1] - out[0]).abs() < PI);
        assert!((out[2] - out[1]).abs() < PI);
    }
}
