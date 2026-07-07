import type { AudioBridge } from '../services/audio-bridge';
import type { WindowManager } from '../windows';

let running = false;

/**
 * Tray-triggered mic check: real capture → real levels → overlay waveform,
 * for the configured duration. The Phase 4 visual proof of the audio path.
 */
export async function runMicCheck(
  windows: WindowManager,
  audio: AudioBridge,
  durationMs = 5_000,
): Promise<void> {
  if (running) return;
  running = true;
  try {
    windows.broadcast('dictation:state', { phase: 'listening' });
    windows.showOverlay();
    audio.requestCapture(true);
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  } finally {
    audio.requestCapture(false);
    windows.broadcast('dictation:state', { phase: 'idle' });
    windows.hideOverlay();
    running = false;
  }
}
