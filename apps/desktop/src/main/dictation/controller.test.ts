import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventChannel, FlowEvents } from '@flow/shared';
import { DictationController } from './controller';
import type { ControllerDeps } from './controller';
import type { AudioFrameMsg } from '../services/audio-bridge';

type Broadcast = { channel: EventChannel; payload: unknown };

function makeDeps(mode: 'hold' | 'toggle' = 'hold') {
  const broadcasts: Broadcast[] = [];
  const calls = { show: 0, hide: 0, capture: [] as boolean[] };
  const deps: ControllerDeps = {
    broadcast: <K extends EventChannel>(channel: K, payload: FlowEvents[K]) => {
      broadcasts.push({ channel, payload });
    },
    showOverlay: () => void calls.show++,
    hideOverlay: () => void calls.hide++,
    requestCapture: (active) => void calls.capture.push(active),
    takePreRoll: () => [],
    getHotkeyMode: () => mode,
  };
  return { deps, broadcasts, calls };
}

function frame(speaking: boolean): AudioFrameMsg {
  return { seq: 0, speaking, rms: speaking ? 0.2 : 0.01, pcm: new Int16Array(320) };
}

function phases(broadcasts: Broadcast[]): string[] {
  return broadcasts
    .filter((b) => b.channel === 'dictation:state')
    .map((b) => (b.payload as { phase: string }).phase);
}

describe('DictationController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('push-to-talk: hold, speak, release → result → confirmed → idle', () => {
    const { deps, broadcasts, calls } = makeDeps('hold');
    const controller = new DictationController(deps);

    controller.onChordDown();
    expect(calls.show).toBe(1);
    expect(calls.capture).toEqual([true]);

    controller.onVad(true);
    controller.onFrame(frame(true));
    vi.advanceTimersByTime(500); // held past the tap threshold
    vi.setSystemTime(Date.now()); // keep Date.now aligned with fake timers
    controller.onChordUp();

    expect(calls.capture).toEqual([true, false]);
    expect(phases(broadcasts)).toEqual(['armed', 'listening', 'processing', 'confirmed']);
    expect(broadcasts.some((b) => b.channel === 'dictation:result')).toBe(true);

    vi.advanceTimersByTime(3000);
    expect(phases(broadcasts)).toContain('idle');
    expect(calls.hide).toBe(1);
  });

  it('tap latches into toggle; VAD silence finishes', () => {
    const { deps, broadcasts } = makeDeps('hold');
    const controller = new DictationController(deps);

    controller.onChordDown();
    controller.onChordUp(); // instant release = tap → latched
    controller.onVad(true);
    controller.onFrame(frame(true));
    expect(controller.currentPhase).toBe('listening');

    controller.onVad(false); // hangover elapsed → silence ends the session
    expect(phases(broadcasts)).toContain('processing');
  });

  it('second tap ends a latched session', () => {
    const { deps, broadcasts } = makeDeps('hold');
    const controller = new DictationController(deps);

    controller.onChordDown();
    controller.onChordUp(); // tap
    controller.onVad(true);
    controller.onChordDown(); // second tap finishes
    // The stub finalize() is synchronous, so processing has already resolved.
    expect(phases(broadcasts)).toContain('processing');
    expect(controller.currentPhase).toBe('confirmed');
  });

  it('no speech → no-speech error, then back to idle', () => {
    const { deps, broadcasts, calls } = makeDeps('hold');
    const controller = new DictationController(deps);

    controller.onChordDown();
    vi.advanceTimersByTime(500);
    vi.setSystemTime(Date.now());
    controller.onChordUp();

    expect(controller.currentPhase).toBe('error');
    const error = broadcasts.find((b) => b.channel === 'dictation:error');
    expect((error?.payload as { kind: string }).kind).toBe('no-speech');

    vi.advanceTimersByTime(4000);
    expect(controller.currentPhase).toBe('idle');
    expect(calls.hide).toBe(1);
  });

  it('cancel stops capture and hides immediately', () => {
    const { deps, calls } = makeDeps('hold');
    const controller = new DictationController(deps);

    controller.onChordDown();
    controller.onVad(true);
    controller.cancel();

    expect(controller.currentPhase).toBe('idle');
    expect(calls.capture).toEqual([true, false]);
    expect(calls.hide).toBe(1);
  });

  it('mic failure during a session surfaces no-mic', () => {
    const { deps, broadcasts } = makeDeps('hold');
    const controller = new DictationController(deps);

    controller.onChordDown();
    controller.onCaptureError('device lost');
    const error = broadcasts.find((b) => b.channel === 'dictation:error');
    expect((error?.payload as { kind: string }).kind).toBe('no-mic');
  });
});
