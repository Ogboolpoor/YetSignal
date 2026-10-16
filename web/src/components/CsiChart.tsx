import { useEffect, useRef } from 'react';

/** Live CSI amplitude across subcarriers for one node (debug preview; raw CSI is
 *  never stored — NFR-21). Drawn as a filled area chart. */
export function CsiChart({ amplitude }: { amplitude: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const W = cv.width;
    const H = cv.height;
    ctx.clearRect(0, 0, W, H);
    if (!amplitude.length) return;
    const max = Math.max(1, ...amplitude);
    const dx = W / (amplitude.length - 1);
    ctx.beginPath();
    ctx.moveTo(0, H);
    amplitude.forEach((v, i) => ctx.lineTo(i * dx, H - (v / max) * (H - 6) - 3));
    ctx.lineTo(W, H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(79,140,255,0.55)');
    grad.addColorStop(1, 'rgba(79,140,255,0.03)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    amplitude.forEach((v, i) => {
      const y = H - (v / max) * (H - 6) - 3;
      i ? ctx.lineTo(i * dx, y) : ctx.moveTo(0, y);
    });
    ctx.strokeStyle = '#4f8cff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [amplitude]);

  return <canvas ref={ref} width={520} height={120} className="full" style={{ height: 120 }} />;
}
