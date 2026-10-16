/**
 * FR-10 — fall detection.
 *
 * A fall has a characteristic signature: a brief, large spike in motion energy
 * (the impact / rapid descent) immediately followed by a sustained period of
 * very low motion (the person is on the floor, not moving). We model this as a
 * small state machine fed with the aggregate motion level each inference tick.
 */
type Phase = 'idle' | 'armed' | 'fallen';

export class FallDetector {
  private phase: Phase = 'idle';
  private recent: { t: number; level: number }[] = [];
  private armedAt = 0;
  private fallenAt = 0;

  /** @param sensitivity 0..1 — higher lowers the spike threshold. */
  update(motionLevel: number, sensitivity: number, now: number): boolean {
    const spikeThresh = 0.75 - 0.45 * sensitivity; // 0.3 .. 0.75
    const stillThresh = 0.08;
    // Motion energy is windowed, so an impact ramps up over a few ticks rather
    // than jumping in one: measure the rise against the quietest level of the
    // last second.
    this.recent.push({ t: now, level: motionLevel });
    while (this.recent.length && now - this.recent[0].t > 1000) this.recent.shift();
    let baseline = motionLevel;
    for (const r of this.recent) baseline = Math.min(baseline, r.level);
    const delta = motionLevel - baseline;

    switch (this.phase) {
      case 'idle':
        if (delta > spikeThresh && motionLevel > 0.5) {
          this.phase = 'armed';
          this.armedAt = now;
        }
        break;
      case 'armed':
        if (now - this.armedAt > 2500) {
          this.phase = 'idle'; // spike not followed by stillness → not a fall
        } else if (now - this.armedAt > 600 && motionLevel < stillThresh) {
          this.phase = 'fallen';
          this.fallenAt = now;
        }
        break;
      case 'fallen':
        // latch the alert for 8 s, then clear if motion resumes
        if (now - this.fallenAt > 8000 && motionLevel > stillThresh) {
          this.phase = 'idle';
        }
        break;
    }
    return this.phase === 'fallen';
  }
}
