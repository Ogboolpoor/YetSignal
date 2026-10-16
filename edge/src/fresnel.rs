//! FR-08 — Fresnel-zone modeling.
//!
//! Between a Tx and an Rx, space is divided into concentric ellipsoidal Fresnel
//! zones; a reflector crossing zone boundaries modulates the received signal.
//! `fresnel_zone` returns the zone index of a reflection point, and
//! `FresnelExtractor` isolates the slow Fresnel modulation (DC-removed, smoothed)
//! from an amplitude stream — the basis for respiration / fine-motion estimation.

pub const C: f32 = 299_792_458.0; // m/s

/// Wavelength (m) for a given carrier frequency.
#[inline]
pub fn wavelength(freq_hz: f32) -> f32 {
    C / freq_hz
}

#[inline]
fn dist(a: [f32; 3], b: [f32; 3]) -> f32 {
    let dx = a[0] - b[0];
    let dy = a[1] - b[1];
    let dz = a[2] - b[2];
    (dx * dx + dy * dy + dz * dz).sqrt()
}

/// Fresnel zone number of reflection point `p` for the Tx→Rx link.
/// Zone n boundary: |TP| + |PR| − |TR| = n·λ/2.
pub fn fresnel_zone(tx: [f32; 3], rx: [f32; 3], p: [f32; 3], lambda: f32) -> i32 {
    let excess = dist(tx, p) + dist(p, rx) - dist(tx, rx);
    ((2.0 * excess) / lambda).round().max(0.0) as i32
}

/// Isolates the slow Fresnel modulation from an amplitude stream: subtracts a
/// slow DC baseline (long EMA) and smooths the residual (short EMA).
pub struct FresnelExtractor {
    dc: f32,
    out: f32,
    inited: bool,
    dc_alpha: f32,
    smooth_alpha: f32,
}

impl FresnelExtractor {
    pub fn new(dc_alpha: f32, smooth_alpha: f32) -> Self {
        Self {
            dc: 0.0,
            out: 0.0,
            inited: false,
            dc_alpha,
            smooth_alpha,
        }
    }

    #[inline]
    pub fn push(&mut self, amplitude: f32) -> f32 {
        if !self.inited {
            self.dc = amplitude;
            self.inited = true;
        }
        self.dc += self.dc_alpha * (amplitude - self.dc);
        let residual = amplitude - self.dc;
        self.out += self.smooth_alpha * (residual - self.out);
        self.out
    }
}

impl Default for FresnelExtractor {
    fn default() -> Self {
        Self::new(0.01, 0.4)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zone_zero_on_direct_path() {
        // A point on the straight line Tx→Rx has ~zero excess path → zone 0.
        let tx = [0.0, 0.0, 0.0];
        let rx = [4.0, 0.0, 0.0];
        let p = [2.0, 0.0, 0.0];
        assert_eq!(fresnel_zone(tx, rx, p, wavelength(2.437e9)), 0);
    }

    #[test]
    fn extractor_removes_dc() {
        let mut fx = FresnelExtractor::default();
        let mut last = 0.0;
        for _ in 0..2000 {
            last = fx.push(100.0); // constant input → output should decay to ~0
        }
        assert!(last.abs() < 1.0, "DC not removed: {}", last);
    }
}
