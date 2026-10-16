//! Edge signal-processing pipeline (level 2). Per CSI frame:
//!   1. amplitude + phase extraction,
//!   2. Hampel outlier rejection on amplitude (FR-06),
//!   3. SpotFi phase sanitisation (FR-07),
//!   4. Fresnel slow-modulation extraction on the most-modulated subcarrier (FR-08),
//!   5. short-term motion energy and per-subcarrier variance energy.
//!
//! Buffers are preallocated and the hot loops are written to auto-vectorise
//! (SIMD) so a single frame is processed in the microsecond range (KPI-04).

use crate::fresnel::FresnelExtractor;
use crate::{hampel, phase};

/// Result of processing one frame for one node.
pub struct Processed<'a> {
    pub amplitude: &'a [f32],
    pub phase: &'a [f32],
    pub fresnel: f32,
    /// Short-term motion energy in [0, 1].
    pub motion_energy: f32,
    /// Mean per-subcarrier amplitude variance (robust presence signal).
    pub var_energy: f32,
}

pub struct Pipeline {
    n: usize,
    amplitude: Vec<f32>,
    phase: Vec<f32>,
    prev_amp: Vec<f32>,
    has_prev: bool,
    ema_mean: Vec<f32>,
    ema_var: Vec<f32>,
    motion: f32,
    k_sel: usize,
    fresnel: FresnelExtractor,
}

impl Pipeline {
    pub fn new(subcarriers: usize) -> Self {
        Self {
            n: subcarriers,
            amplitude: vec![0.0; subcarriers],
            phase: vec![0.0; subcarriers],
            prev_amp: vec![0.0; subcarriers],
            has_prev: false,
            ema_mean: vec![0.0; subcarriers],
            ema_var: vec![0.0; subcarriers],
            motion: 0.0,
            k_sel: 0,
            fresnel: FresnelExtractor::default(),
        }
    }

    /// Process one frame given interleaved-free I and Q slices.
    pub fn process(&mut self, re: &[f32], im: &[f32]) -> Processed<'_> {
        let n = self.n;

        // amplitude (magnitude) — vectorisable
        for k in 0..n {
            self.amplitude[k] = (re[k] * re[k] + im[k] * im[k]).sqrt();
        }

        hampel::hampel(&mut self.amplitude, 3, 3.0); // FR-06
        phase::sanitise_phase(re, im, &mut self.phase); // FR-07

        // motion energy: normalised mean absolute amplitude change between frames
        let mut energy = 0.0f32;
        if self.has_prev {
            let mut diff = 0.0f32;
            let mut mag = 0.0f32;
            for k in 0..n {
                diff += (self.amplitude[k] - self.prev_amp[k]).abs();
                mag += self.amplitude[k];
            }
            energy = if mag > 0.0 {
                (diff / mag * 6.0).min(1.0)
            } else {
                0.0
            };
        }
        self.prev_amp.copy_from_slice(&self.amplitude);
        self.has_prev = true;
        self.motion += 0.35 * (energy - self.motion);

        // per-subcarrier running mean/variance; pick the most-modulated subcarrier
        if !self.ema_inited() {
            self.ema_mean.copy_from_slice(&self.amplitude);
        }
        let mut k_var = 0usize;
        let mut v_max = f32::MIN;
        let mut v_sum = 0.0f32;
        let mut amp_sum = 0.0f32;
        for k in 0..n {
            let d = self.amplitude[k] - self.ema_mean[k];
            self.ema_mean[k] += 0.02 * d;
            self.ema_var[k] += 0.02 * (d * d - self.ema_var[k]);
            v_sum += self.ema_var[k];
            amp_sum += self.amplitude[k];
            if self.ema_var[k] > v_max {
                v_max = self.ema_var[k];
                k_var = k;
            }
        }
        // hysteresis on the tracked subcarrier
        if self.ema_var[k_var] > self.ema_var[self.k_sel] * 1.3 {
            self.k_sel = k_var;
        }
        // coefficient of variation (std / mean): scale-invariant presence signal
        let mean_amp = amp_sum / n as f32;
        let var_energy = (v_sum / n as f32).sqrt() / mean_amp.max(1e-6);
        let fresnel = self
            .fresnel
            .push(self.amplitude[self.k_sel] - self.ema_mean[self.k_sel]); // FR-08

        Processed {
            amplitude: &self.amplitude,
            phase: &self.phase,
            fresnel,
            motion_energy: self.motion,
            var_energy,
        }
    }

    #[inline]
    fn ema_inited(&self) -> bool {
        self.has_prev // ema_mean is seeded on the first frame alongside prev_amp
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // tiny deterministic PRNG for tests
    struct Lcg(u64);
    impl Lcg {
        fn nf(&mut self) -> f32 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1);
            ((self.0 >> 40) as f32 / (1u32 << 24) as f32) * 2.0 - 1.0
        }
    }

    /// base multipath + optional breathing reflector + receiver noise
    fn synth(re: &mut [f32], im: &mut [f32], t: f32, occupied: bool, rng: &mut Lcg) {
        let n = re.len();
        let lambda = 0.122f32;
        for k in 0..n {
            let base = std::f32::consts::TAU * k as f32 / n as f32;
            let mut r = 10.0 * base.cos();
            let mut i = 10.0 * base.sin();
            if occupied {
                let d = 3.0;
                let gain = 5.0 / (1.0 + d);
                let breath = 0.8 * (std::f32::consts::TAU * 0.25 * t).sin();
                let phi = std::f32::consts::TAU * d / lambda
                    + std::f32::consts::TAU * k as f32 * d / (n as f32 * lambda)
                    + breath;
                r += gain * phi.cos();
                i += gain * phi.sin();
            }
            re[k] = r + rng.nf() * 0.05;
            im[k] = i + rng.nf() * 0.05;
        }
    }

    #[test]
    fn empty_room_low_variance_occupied_high() {
        let n = 56;
        let fs = 25.0f32;
        let (mut re, mut im) = (vec![0.0f32; n], vec![0.0f32; n]);

        let mut pl = Pipeline::new(n);
        let mut rng = Lcg(1);
        let mut empty_var = 0.0;
        for t in 0..600 {
            synth(&mut re, &mut im, t as f32 / fs, false, &mut rng);
            empty_var = pl.process(&re, &im).var_energy;
        }

        let mut pl2 = Pipeline::new(n);
        let mut rng2 = Lcg(2);
        let mut occ_var = 0.0;
        for t in 0..600 {
            synth(&mut re, &mut im, t as f32 / fs, true, &mut rng2);
            occ_var = pl2.process(&re, &im).var_energy;
        }
        assert!(
            occ_var > empty_var * 3.0,
            "expected occupied var ({occ_var}) >> empty var ({empty_var})"
        );
    }
}
