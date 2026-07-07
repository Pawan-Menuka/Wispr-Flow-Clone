import { uIOhook } from 'uiohook-napi';
import { ESC_KEYCODE, chordSatisfied, parseChord } from './chords';
import type { ChordGroups } from './chords';

/**
 * Global keyboard hook (BLUEPRINT §14.1, Windows-first via uiohook-napi).
 * Listen-only: the hook cannot swallow keys, which is acceptable for
 * modifier-only chords like Ctrl+Win. Emits edge events for the dictation
 * chord plus Escape (cancel-while-dictating).
 */
export class HotkeyService {
  private downKeys = new Set<number>();
  private dictateGroups: ChordGroups | null = null;
  private dictateActive = false;
  private started = false;

  private downListeners = new Set<() => void>();
  private upListeners = new Set<() => void>();
  private escListeners = new Set<() => void>();

  setDictateChord(chord: string): boolean {
    const groups = parseChord(chord);
    if (!groups) return false;
    this.dictateGroups = groups;
    this.dictateActive = false;
    return true;
  }

  onDictateDown(listener: () => void): () => void {
    this.downListeners.add(listener);
    return () => this.downListeners.delete(listener);
  }

  onDictateUp(listener: () => void): () => void {
    this.upListeners.add(listener);
    return () => this.upListeners.delete(listener);
  }

  onEscape(listener: () => void): () => void {
    this.escListeners.add(listener);
    return () => this.escListeners.delete(listener);
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    uIOhook.on('keydown', (event) => {
      this.downKeys.add(event.keycode);
      if (event.keycode === ESC_KEYCODE) {
        for (const listener of this.escListeners) listener();
      }
      this.evaluate();
    });

    uIOhook.on('keyup', (event) => {
      this.downKeys.delete(event.keycode);
      this.evaluate();
    });

    uIOhook.start();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    uIOhook.stop();
    this.downKeys.clear();
    this.dictateActive = false;
  }

  private evaluate(): void {
    if (!this.dictateGroups) return;
    const satisfied = chordSatisfied(this.dictateGroups, this.downKeys);
    if (satisfied && !this.dictateActive) {
      this.dictateActive = true;
      for (const listener of this.downListeners) listener();
    } else if (!satisfied && this.dictateActive) {
      this.dictateActive = false;
      for (const listener of this.upListeners) listener();
    }
  }
}
