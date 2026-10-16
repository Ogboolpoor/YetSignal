import { useEffect, useRef } from 'react';

/** Renders the row-major activity grid (FR-20) with a blue→green→yellow→red ramp. */
export function Heatmap({ data, w, h }: { data: number[]; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const W = cv.width;
    const H = cv.height;
    const cw = W / w;
    const ch = H / h;
    ctx.clearRect(0, 0, W, H);
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const v = data[gy * w + gx] ?? 0;
        ctx.fillStyle = ramp(v);
        ctx.fillRect(gx * cw, gy * ch, cw + 1, ch + 1);
      }
    }
  }, [data, w, h]);

  return <canvas ref={ref} width={540} height={360} className="full" style={{ aspectRatio: `${w}/${h}`, height: 'auto', background: '#0b0f17' }} />;
}

function ramp(v: number): string {
  const c = Math.max(0, Math.min(1, v));
  // 0 = dark blue, .33 = teal, .66 = yellow, 1 = red
  const stops = [
    [13, 19, 33],
    [40, 120, 200],
    [40, 214, 168],
    [255, 176, 32],
    [255, 90, 110],
  ];
  const seg = c * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = stops[i];
  const b = stops[i + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * f);
  const g = Math.round(a[1] + (b[1] - a[1]) * f);
  const bl = Math.round(a[2] + (b[2] - a[2]) * f);
  return `rgb(${r},${g},${bl})`;
}
