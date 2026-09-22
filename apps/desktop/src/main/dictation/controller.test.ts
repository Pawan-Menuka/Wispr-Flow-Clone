import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventChannel, FlowEvents } from '@flow/shared';
import { DictationController } from './controller';
import type { ControllerDeps } from './controller';
import type { AudioFrameMsg } from '../services/audio-bridge';
import type { SttSessionHandle } from '../services/ws-client';

type Broadcast = { channel: EventChannel; payload: unknown };

class FakeStt implements SttSessionHandle {
  sent: number[] = [];
  finished: number | null = null;
  cancelled = false;
  private interimCb: ((i: { text: string; stableWords: number }) => void) | null = null;
  private resultCb:
    | ((r: {
        finalText: string;
        formatted: boolean;
        wordCount: number;
        durationMs: number;
        latencyMs: number;
      }) => void)
    | null = null;
  private errorCb: ((code: string, message: string) => void) | null = null;

  sendAudio(seq: number): void {
    this.sent.push(seq);
  }
  finish(lastSeq: number): void {
    this.finished = lastSeq;
  }
  cancel(): void {
    this.cancelled = true;
  }
  onReady(): void {}
  onInterim(cb: (i: { text: string; stableWords: number }) => void): void {
    this.interimCb = cb;
  }
  onResult(
    cb: (r: {
      finalText: string;
      formatted: boolean;
      wordCount: number;
      durationMs: number;
      latencyMs: number;
    }) => void,
  ): void {
    this.resultCb = cb;
  }
  onError(cb: (code: string, message: string) => void): void {
    this.errorCb = cb;
  }

  emitInterim(text: string, stableWords = 0): void {
    this.interimCb?.({ text, stableWords });
  }
  emitResult(finalText: string): void {
    this.resultCb?.({ finalText, formatted: true, wordCount: 2, durationMs: 500, latencyMs: 90 });
  }
  emitError(code: string, message = 'boom'): void {
    this.errorCb?.(code, message);
  }
}

function makeDeps(
  mode: 'hold' | 'toggle' = 'hold',
  opts: {
    connected?: boolean;
    insertOk?: boolean;
    focusedApp?: { processName: string; profile: string } | null;
  } = {},
) {
  const { connected = true, insertOk = true, focusedApp = null } = opts;
  const broadcasts: Broadcast[] = [];
  const calls = {
    show: 0,
    hide: 0,
    capture: [] as boolean[],
    inserted: [] as string[],
    history: [] as string[],
  };
  let stt: FakeStt | null = null;
  const deps: ControllerDeps = {
    broadcast: <K extends EventChannel>(channel: K, payload: FlowEvents[K]) => {
      broadcasts.push({ channel, payload });
    },
    showOverlay: () => void calls.show++,
    hideOverlay: () => void calls.hide++,
    requestCapture: (active) => void calls.capture.push(active),
    takePreRoll: () => [],
    getHotkeyMode: () => mode,
    getFocusedApp: () => focusedApp,
    startSttSession: () => {
      if (!connected) return null;
      stt = new FakeStt();
      return stt;
    },
    insertText: (text) => {
      calls.inserted.push(text);
      return Promise.resolve(insertOk);
    },
    addHistory: (entry) => {
      calls.history.push(entry.finalText);
    },
  };
  return { deps, broadcasts, calls, getStt: () => stt };
}

/** Drain microtasks (insertText resolution) under fake timers. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function frame(seq: number, speaking: boolean): AudioFrameMsg {
  return { seq, speaking, rms: speaking ? 0.2 : 0.01, pcm: new Int16Array(320) };
}

function phases(broadcasts: Broadcast[]): string[] {
  return broadcasts
    .filter((b) => b.channel === 'dictation:state')
    .map((b) => (b.payload as { phase: string }).phase);
}

describe('DictationController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('push-to-talk: hold, speak, release → result → inserted → confirmed → idle', async () => {
    const { deps, broadcasts, calls, getStt } = makeDeps('hold');
    const controller = new DictationController(deps);

    controller.onChordDown();
    expect(calls.show).toBe(1);
    expect(calls.capture).toEqual([true]);

    controller.onVad(true);
    controller.onFrame(frame(0, true));
    controller.onFrame(frame(1, true));
    vi.advanceTimersByTime(500);
    controller.onChordUp();

    const stt = getStt()!;
    expect(stt.sent).toEqual([0, 1]);
    expect(stt.finished).toBe(1); // lastSeq
    expect(controller.currentPhase).toBe('processing');

    stt.emitResult('Hello world.');
    await flush();
    expect(phases(broadcasts)).toEqual([
      'armed',
      'listening',
      'processing',
      'inserting',
      'confirmed',
    ]);
    expect(calls.inserted).toEqual(['Hello world.']);
    expect(calls.history).toEqual(['Hello world.']);
    const result = broadcasts.find((b) => b.channel === 'dictation:result');
    expect((result?.payload as { text: string }).text).toBe('Hello world.');

    vi.advanceTimersByTime(3000);
    expect(controller.currentPhase).toBe('idle');
    expect(calls.hide).toBe(1);
  });

  it('insertion failure degrades to clipboard message', async () => {
    const { deps, broadcasts, getStt } = makeDeps('hold', { insertOk: false });
    const controller = new DictationController(deps);
    controller.onChordDown();
    controller.onVad(true);
    controller.onFrame(frame(0, true));
    vi.advanceTimersByTime(500);
    controller.onChordUp();
    getStt()!.emitResult('Hello.');
    await flush();

    expect(controller.currentPhase).toBe('error');
    const error = broadcasts.find((b) => b.channel === 'dictation:error');
    expect((error?.payload as { kind: string }).kind).toBe('insertion-failed');
  });

  it('relays interims while listening', () => {
    const { deps, broadcasts, getStt } = makeDeps('hold');
    const controller = new DictationController(deps);
    controller.onChordDown();
    getStt()!.emitInterim('hello wor', 1);
    const interim = broadcasts.find((b) => b.channel === 'dictation:interim');
    expect((interim?.payload as { text: string }).text).toBe('hello wor');
  });

  it('hold mode: even a quick release finishes immediately', () => {
    const { deps, getStt } = makeDeps('hold');
    const controller = new DictationController(deps);

    controller.onChordDown();
    controller.onVad(true);
    controller.onFrame(frame(0, true));
    controller.onChordUp();

    expect(controller.currentPhase).toBe('processing');
    expect(getStt()!.finished).toBe(0);
  });

  it('toggle mode: release keeps listening and the next press finishes', () => {
    const { deps, getStt } = makeDeps('toggle');
    const controller = new DictationController(deps);

    controller.onChordDown();
    controller.onChordUp();
    controller.onVad(true);
    controller.onFrame(frame(0, true));
    expect(controller.currentPhase).toBe('listening');

    controller.onChordDown();
    expect(controller.currentPhase).toBe('processing');
    expect(getStt()!.finished).toBe(0);
  });

  it('no speech → cancels the session and reports no-speech', () => {
    const { deps, broadcasts, getStt } = makeDeps('hold');
    const controller = new DictationController(deps);

    controller.onChordDown();
    vi.advanceTimersByTime(500);
    controller.onChordUp();

    expect(controller.currentPhase).toBe('error');
    expect(getStt()!.cancelled).toBe(true);
    const error = broadcasts.find((b) => b.channel === 'dictation:error');
    expect((error?.payload as { kind: string }).kind).toBe('no-speech');
  });

  it('API unreachable → immediate network error', () => {
    const { deps, broadcasts } = makeDeps('hold', { connected: false });
    const controller = new DictationController(deps);
    controller.onChordDown();
    expect(controller.currentPhase).toBe('error');
    const error = broadcasts.find((b) => b.channel === 'dictation:error');
    expect((error?.payload as { kind: string }).kind).toBe('network');
  });

  it('server error during processing maps codes to ErrorKind', () => {
    const { deps, broadcasts, getStt } = makeDeps('hold');
    const controller = new DictationController(deps);
    controller.onChordDown();
    controller.onVad(true);
    controller.onFrame(frame(0, true));
    vi.advanceTimersByTime(500);
    controller.onChordUp();

    getStt()!.emitError('QUOTA', 'limit reached');
    expect(controller.currentPhase).toBe('error');
    const error = broadcasts.find((b) => b.channel === 'dictation:error');
    expect((error?.payload as { kind: string }).kind).toBe('quota-exceeded');
  });

  it('result timeout degrades to a network error', () => {
    const { deps } = makeDeps('hold');
    const controller = new DictationController(deps);
    controller.onChordDown();
    controller.onVad(true);
    controller.onFrame(frame(0, true));
    vi.advanceTimersByTime(500);
    controller.onChordUp();
    expect(controller.currentPhase).toBe('processing');

    vi.advanceTimersByTime(10_000);
    expect(controller.currentPhase).toBe('error');
  });

  it('profile "off" refuses before recording', () => {
    const { deps, broadcasts, calls } = makeDeps('hold', {
      focusedApp: { processName: 'secretapp.exe', profile: 'off' },
    });
    const controller = new DictationController(deps);
    controller.onChordDown();

    expect(controller.currentPhase).toBe('error');
    expect(calls.capture).toEqual([]); // mic never started
    const error = broadcasts.find((b) => b.channel === 'dictation:error');
    expect((error?.payload as { kind: string }).kind).toBe('app-disabled');
  });

  it('focused app flows into insertion and history', async () => {
    const { deps, calls, getStt, broadcasts } = makeDeps('hold', {
      focusedApp: { processName: 'slack.exe', profile: 'slack' },
    });
    const controller = new DictationController(deps);
    controller.onChordDown();
    controller.onVad(true);
    controller.onFrame(frame(0, true));
    vi.advanceTimersByTime(500);
    controller.onChordUp();
    getStt()!.emitResult('Hey team.');
    await flush();

    const result = broadcasts.find((b) => b.channel === 'dictation:result');
    expect((result?.payload as { appName: string }).appName).toBe('slack.exe');
    expect(calls.inserted).toEqual(['Hey team.']);
  });

  it('cancel stops capture and cancels the session', () => {
    const { deps, calls, getStt } = makeDeps('hold');
    const controller = new DictationController(deps);
    controller.onChordDown();
    controller.onVad(true);
    controller.cancel();

    expect(controller.currentPhase).toBe('idle');
    expect(calls.capture).toEqual([true, false]);
    expect(getStt()!.cancelled).toBe(true);
    expect(calls.hide).toBe(1);
  });
});
