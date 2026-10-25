/** Snapshot interpolation for entities the client does not control. */

export interface Sample {
  t: number;
  x: number;
  y: number;
}

export class InterpolationBuffer {
  private samples: Sample[] = [];

  push(t: number, x: number, y: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last && t <= last.t) return;
    // After a visibility gap the old samples are stale: don't glide from where we last saw them.
    if (last && t - last.t > 500) this.samples = [];
    this.samples.push({ t, x, y });
    if (this.samples.length > 30) this.samples.shift();
  }

  /** Position at renderTime, clamped to the oldest/newest sample (no extrapolation). */
  sample(renderTime: number): { x: number; y: number } | null {
    const s = this.samples;
    if (s.length === 0) return null;
    const first = s[0]!;
    if (renderTime <= first.t) return { x: first.x, y: first.y };
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1]!;
      const b = s[i]!;
      if (renderTime >= a.t) {
        if (renderTime >= b.t) return { x: b.x, y: b.y };
        const k = (renderTime - a.t) / (b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
    }
    return { x: first.x, y: first.y };
  }
}
