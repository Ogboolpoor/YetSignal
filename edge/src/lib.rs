//! # yetsignal-edge
//!
//! Performance-critical CSI signal-processing & inference for YetSignal's edge
//! layer (NFR-07). Pure-Rust, no external dependencies, written so the hot loops
//! auto-vectorise to SIMD. Mirrors the reference TypeScript pipeline in the
//! sensing server so the two stay behaviourally aligned.
//!
//! Pipeline stages:
//! - [`hampel`] — FR-06 outlier rejection (MAD)
//! - [`phase`]  — FR-07 SpotFi phase sanitisation
//! - [`fresnel`] — FR-08 Fresnel-zone modeling
//! - [`pipeline`] — per-frame orchestration (KPI-04 microsecond budget)
//! - [`vitals`] — FR-11/FR-12 spectral rate estimation

pub mod fresnel;
pub mod hampel;
pub mod phase;
pub mod pipeline;
pub mod vitals;

pub use fresnel::{fresnel_zone, wavelength, FresnelExtractor};
pub use pipeline::{Pipeline, Processed};
pub use vitals::{estimate_rate, RateEstimate};
