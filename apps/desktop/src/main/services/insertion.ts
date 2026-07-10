import { Notification, clipboard } from 'electron';
import type { NativeImage } from 'electron';
import { UiohookKey, uIOhook } from 'uiohook-napi';

/**
 * Text insertion, tier 2 of the BLUEPRINT §14.3 chain: clipboard-swap +
 * synthetic paste + full-format restore. The workhorse (~95% of insertions).
 * Tier 1 (direct accessibility APIs) and tier 3 (unicode keystrokes) arrive
 * with the native focus/insert addons (Phase 16+).
 *
 * The quirks table is keyed by lowercase process name; entries grow from
 * real-world failures (per-app settle delays, Ctrl+Shift+V terminals).
 * Until the focus tracker lands (Phase 16) callers pass 'unknown' and the
 * default quirk applies.
 */

export interface AppQuirk {
  /** Delay before restoring the clipboard (target app must finish reading it). */
  settleMs?: number;
  /** Terminals and some TUIs paste with Ctrl+Shift+V. */
  pasteWithShift?: boolean;
}

const DEFAULT_SETTLE_MS = 150;

export const APP_QUIRKS: Record<string, AppQuirk> = {
  'windowsterminal.exe': { pasteWithShift: true },
  'wt.exe': { pasteWithShift: true },
  'mintty.exe': { pasteWithShift: true },
  // Slow electron apps that read the clipboard lazily:
  'notion.exe': { settleMs: 400 },
};

interface ClipboardSnapshot {
  text: string;
  html: string;
  rtf: string;
  image: NativeImage;
}

export interface InsertResult {
  ok: boolean;
  method: 'paste' | 'clipboard-fallback';
}

const UNDO_WINDOW_MS = 60_000;

export class InsertionService {
  private inFlight = false;
  private lastInsertion: { text: string; at: number } | null = null;

  async insertText(text: string, processName = 'unknown'): Promise<InsertResult> {
    if (this.inFlight) return { ok: false, method: 'clipboard-fallback' };
    this.inFlight = true;
    const quirk = APP_QUIRKS[processName.toLowerCase()] ?? {};
    const snapshot = this.snapshotClipboard();

    try {
      clipboard.writeText(text);
      await sleep(40); // let the clipboard propagate before the paste lands

      const modifier = process.platform === 'darwin' ? UiohookKey.Meta : UiohookKey.Ctrl;
      const modifiers = quirk.pasteWithShift ? [modifier, UiohookKey.Shift] : [modifier];
      uIOhook.keyTap(UiohookKey.V, modifiers);

      await sleep(quirk.settleMs ?? DEFAULT_SETTLE_MS);
      this.restoreClipboard(snapshot);
      this.lastInsertion = { text, at: Date.now() };
      return { ok: true, method: 'paste' };
    } catch (err) {
      console.warn('[insertion] paste failed:', err instanceof Error ? err.message : err);
      // Degrade per §3.1: leave the text on the clipboard and tell the user.
      clipboard.writeText(text);
      new Notification({
        title: 'Flow',
        body: 'Couldn’t insert — your text is on the clipboard, press Ctrl+V.',
      }).show();
      return { ok: false, method: 'clipboard-fallback' };
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Undo the last insertion (§2 F15): synthetic Ctrl+Z aimed at the app that
   * received the paste, valid only within a short window. Fragile by nature —
   * the restore stack always keeps the text as the safety net.
   */
  async undo(): Promise<{ ok: boolean; method: 'synthetic-undo' | 'none'; message?: string }> {
    if (!this.lastInsertion || Date.now() - this.lastInsertion.at > UNDO_WINDOW_MS) {
      return { ok: false, method: 'none', message: 'Nothing recent to undo' };
    }
    try {
      const modifier = process.platform === 'darwin' ? UiohookKey.Meta : UiohookKey.Ctrl;
      uIOhook.keyTap(UiohookKey.Z, [modifier]);
      this.lastInsertion = null;
      return { ok: true, method: 'synthetic-undo' };
    } catch (err) {
      return {
        ok: false,
        method: 'none',
        message: err instanceof Error ? err.message : 'Undo failed',
      };
    }
  }

  private snapshotClipboard(): ClipboardSnapshot {
    return {
      text: clipboard.readText(),
      html: clipboard.readHTML(),
      rtf: clipboard.readRTF(),
      image: clipboard.readImage(),
    };
  }

  private restoreClipboard(snapshot: ClipboardSnapshot): void {
    if (!snapshot.image.isEmpty()) {
      clipboard.writeImage(snapshot.image);
      return;
    }
    const data: { text?: string; html?: string; rtf?: string } = {};
    if (snapshot.text) data.text = snapshot.text;
    if (snapshot.html) data.html = snapshot.html;
    if (snapshot.rtf) data.rtf = snapshot.rtf;
    if (Object.keys(data).length > 0) clipboard.write(data);
    else clipboard.clear();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
