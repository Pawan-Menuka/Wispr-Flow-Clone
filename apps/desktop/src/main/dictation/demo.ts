import { randomUUID } from 'node:crypto';
import type { WindowManager } from '../windows';

/**
 * Scripted dictation timeline (Phase 3 stand-in for the real
 * DictationController arriving in Phase 5). Exercises the full overlay
 * path: state transitions, audio levels, interims, result, chips.
 * Triggered from the tray ("Demo dictation") and by `--smoke`.
 */

/** Last finished dictation, consumed by clipboard:copyResult / undo stubs. */
export const lastResult: { id: string | null; text: string } = { id: null, text: '' };

let running = false;

export async function runDemoDictation(
  windows: WindowManager,
  opts: { fast?: boolean } = {},
): Promise<void> {
  if (running) return;
  running = true;
  const step = opts.fast ? 40 : 280;
  const sessionId = randomUUID();
  const finalText = 'This is the Flow overlay rendering a demo dictation.';
  const words = finalText.replace(/\./g, '').toLowerCase().split(' ');

  try {
    windows.broadcast('dictation:state', { phase: 'armed', sessionId });
    windows.showOverlay();
    await sleep(step);

    windows.broadcast('dictation:state', { phase: 'listening', sessionId });
    const levelTimer = setInterval(() => {
      windows.broadcast('audio:level', { rms: 0.15 + Math.random() * 0.6 });
    }, 33);

    for (let i = 1; i <= words.length; i++) {
      windows.broadcast('dictation:interim', {
        text: words.slice(0, i).join(' '),
        stableWords: Math.max(0, i - 2),
      });
      await sleep(step);
    }

    // Smoke artifact: snapshot the listening-state pill for visual checks.
    const capturePath = process.env['FLOW_SMOKE_CAPTURE'];
    if (capturePath) {
      const png = await windows.captureOverlay();
      if (png) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(capturePath, png);
      }
    }
    clearInterval(levelTimer);

    windows.broadcast('dictation:state', { phase: 'processing', sessionId });
    await sleep(step * 4);

    lastResult.id = sessionId;
    lastResult.text = finalText;
    windows.broadcast('dictation:result', { id: sessionId, text: finalText, appName: null });
    windows.broadcast('dictation:state', { phase: 'confirmed', sessionId });
    await sleep(step * 12); // chips linger

    windows.broadcast('dictation:state', { phase: 'idle' });
    windows.hideOverlay();
  } finally {
    running = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
