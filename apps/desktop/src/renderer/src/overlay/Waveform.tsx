import { useEffect, useRef } from 'react';

const BAR_COUNT = 20;
const WIDTH = 96;
const HEIGHT = 26;

/**
 * Live amplitude ribbon fed by `audio:level` events (~30 Hz RMS values).
 * Reduced motion → static level bar instead of animated bars (BLUEPRINT §4.2).
 */
export function Waveform() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef<number[]>(Array(BAR_COUNT).fill(0.05));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const unsubscribe = window.flow.on('audio:level', ({ rms }) => {
      const levels = levelsRef.current;
      levels.push(Math.max(0.05, Math.min(1, rms)));
      if (levels.length > BAR_COUNT) levels.shift();
    });

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    let raf = 0;

    const draw = () => {
      if (canvas && ctx) {
        const scale = window.devicePixelRatio || 1;
        if (canvas.width !== WIDTH * scale) {
          canvas.width = WIDTH * scale;
          canvas.height = HEIGHT * scale;
          ctx.scale(scale, scale);
        }
        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        const levels = levelsRef.current;
        const accent = getComputedStyle(document.documentElement)
          .getPropertyValue('--pill-accent')
          .trim();
        ctx.fillStyle = accent || '#8b7cf0';
        const barWidth = 3;
        const gap = (WIDTH - BAR_COUNT * barWidth) / (BAR_COUNT - 1);
        if (reducedMotion) {
          // Static level meter: latest RMS as one horizontal fill.
          const level = levels[levels.length - 1] ?? 0.05;
          ctx.fillRect(0, HEIGHT / 2 - 2, WIDTH * level, 4);
        } else {
          for (let i = 0; i < BAR_COUNT; i++) {
            const level = levels[i] ?? 0.05;
            const barHeight = Math.max(3, level * HEIGHT);
            const x = i * (barWidth + gap);
            ctx.fillRect(x, (HEIGHT - barHeight) / 2, barWidth, barHeight);
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, [reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: WIDTH, height: HEIGHT, display: 'block' }}
      aria-hidden="true"
    />
  );
}
