//! Edge pipeline benchmark — verifies the KPI-04 per-frame processing budget
//! (microsecond range) and demonstrates the empty-vs-occupied variance signal.
//!
//! Run with: `cargo run --release --bin bench`

use std::time::Instant;
use yetsignal_edge::Pipeline;

const N: usize = 56; // BW20 subcarriers (FR-02)
const LAMBDA: f32 = 0.122; // ~2.45 GHz

/// Tiny deterministic PRNG (xorshift) so the bench needs no external crates.
struct Rng(u64);
impl Rng {
    fn next_f32(&mut self) -> f32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        // map to [-1, 1)
        ((x >> 40) as f32 / (1u32 << 24) as f32) * 2.0 - 1.0
    }
}

/// Synthesise one CSI frame; `occupied` adds a breathing reflector + noise.
fn synth(buf_re: &mut [f32], buf_im: &mut [f32], t: f32, occupied: bool, rng: &mut Rng) {
    for k in 0..N {
        let base_ph = std::f32::consts::TAU * k as f32 / N as f32;
        let mut re = 10.0 * base_ph.cos();
        let mut im = 10.0 * base_ph.sin();
        if occupied {
            let d = 3.0;
            let gain = 5.0 / (1.0 + d);
            let breath = 0.8 * (std::f32::consts::TAU * 0.25 * t).sin();
            let phi = std::f32::consts::TAU * d / LAMBDA
                + std::f32::consts::TAU * k as f32 * d / (N as f32 * LAMBDA)
                + breath;
            re += gain * phi.cos();
            im += gain * phi.sin();
        }
        re += rng.next_f32() * 0.05;
        im += rng.next_f32() * 0.05;
        buf_re[k] = re;
        buf_im[k] = im;
    }
}

fn run(occupied: bool, frames: usize) -> (f64, f32) {
    let mut pl = Pipeline::new(N);
    let mut re = vec![0.0f32; N];
    let mut im = vec![0.0f32; N];
    let mut rng = Rng(0x9E3779B97F4A7C15);
    let fs = 25.0f32;

    // warm-up so EMAs settle (not timed)
    for i in 0..400 {
        synth(&mut re, &mut im, i as f32 / fs, occupied, &mut rng);
        let _ = pl.process(&re, &im);
    }

    let mut last_var = 0.0f32;
    let start = Instant::now();
    for i in 0..frames {
        synth(&mut re, &mut im, (400 + i) as f32 / fs, occupied, &mut rng);
        let p = pl.process(&re, &im);
        last_var = p.var_energy;
    }
    let elapsed = start.elapsed();
    let us_per_frame = elapsed.as_secs_f64() * 1e6 / frames as f64;
    (us_per_frame, last_var)
}

fn main() {
    let frames = 200_000;
    println!("YetSignal edge pipeline benchmark");
    println!("  subcarriers : {N} (BW20, FR-02)");
    println!("  frames      : {frames}\n");

    let (us_empty, var_empty) = run(false, frames);
    let (us_occ, var_occ) = run(true, frames);

    let us = (us_empty + us_occ) / 2.0;
    let fps = 1e6 / us;
    println!("per-frame processing time : {us:.3} µs   (KPI-04: microsecond range ✓)");
    println!("throughput                : {fps:.0} frames/s on one core");
    println!("  → can sustain {} nodes @ 25 Hz on a single core\n", (fps / 25.0) as u64);

    println!("variance presence signal (FR-09):");
    println!("  empty room   var_energy = {var_empty:.4}");
    println!("  occupied     var_energy = {var_occ:.4}");
    let ratio = if var_empty > 0.0 { var_occ / var_empty } else { 0.0 };
    println!("  separation ratio        = {ratio:.1}x");

    assert!(us < 1000.0, "KPI-04 violated: {us} µs/frame");
    assert!(var_occ > var_empty * 3.0, "presence signal too weak");
    println!("\nOK");
}
