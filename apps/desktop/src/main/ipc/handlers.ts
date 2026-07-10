import { app, clipboard, ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { InvokeChannel, Settings } from '@flow/shared';
import { OVERLAY_INVOKE_ALLOWLIST, SettingsSchema } from '@flow/shared';
import type { SettingsStore } from '../services/settings-store';
import type { WindowManager } from '../windows';
import type { AuthService } from '../services/auth';
import type { HotkeyService } from '../hotkeys/hotkey-service';
import type { HistoryService } from '../services/history';
import type { InsertionService } from '../services/insertion';
import { findRestorable, lastResult } from '../dictation/results';
import type { DictationController } from '../dictation/controller';

interface IpcContext {
  windows: WindowManager;
  settings: SettingsStore;
  controller: DictationController;
  auth: AuthService;
  hotkeys: HotkeyService;
  history: HistoryService;
  insertion: InsertionService;
}

/** Domains the renderer may ask the OS browser to open (BLUEPRINT §15). */
const EXTERNAL_URL_ALLOWLIST = [
  'https://github.com/',
  'https://flow.app/',
  'ms-settings:privacy-microphone', // onboarding mic-permission recovery (§3.2)
];

/**
 * Typed IPC registration (BLUEPRINT §7.3). Every handler:
 *  1. rejects senders that aren't our windows,
 *  2. rejects overlay senders for non-allowlisted channels,
 *  3. zod-validates its arguments before touching main-process state.
 */
export function registerIpcHandlers(ctx: IpcContext): void {
  const { windows, settings, controller, auth, hotkeys, history, insertion } = ctx;

  function handle<K extends InvokeChannel>(
    channel: K,
    argsSchema: z.ZodTypeAny | null,
    fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ): void {
    ipcMain.handle(channel, (event, ...args) => {
      if (!windows.isKnownSender(event.sender.id)) {
        throw new Error('IPC from unknown sender rejected');
      }
      if (
        windows.isOverlaySender(event.sender.id) &&
        !(OVERLAY_INVOKE_ALLOWLIST as readonly string[]).includes(channel)
      ) {
        throw new Error(`Channel ${channel} not permitted for overlay window`);
      }
      const parsedArgs = argsSchema ? argsSchema.parse(args) : args;
      return fn(event, ...(parsedArgs as unknown[]));
    });
  }

  // ---------- App ----------
  handle('app:getVersion', z.tuple([]), () => app.getVersion());

  handle('app:openExternal', z.tuple([z.string().url()]), (_e, url) => {
    const target = url as string;
    if (!EXTERNAL_URL_ALLOWLIST.some((prefix) => target.startsWith(prefix))) {
      throw new Error('URL not in allowlist');
    }
    void shell.openExternal(target);
  });

  handle('app:openLogsFolder', z.tuple([]), () => {
    void shell.openPath(app.getPath('logs'));
  });

  // ---------- Settings ----------
  handle('settings:get', z.tuple([]), () => settings.snapshot());

  handle('settings:set', z.tuple([z.string(), z.unknown()]), (_e, key, value) => {
    const shape = SettingsSchema.shape as Record<string, z.ZodTypeAny>;
    const schema = typeof key === 'string' ? shape[key] : undefined;
    if (!schema) throw new Error(`Unknown settings key`);
    const parsed = schema.parse(value) as Settings[keyof Settings];
    settings.set(key as keyof Settings, parsed);
    windows.broadcast('settings:changed', { [key as keyof Settings]: parsed });
  });

  // ---------- Dictation results ----------
  handle('clipboard:copyResult', z.tuple([z.string()]), (_e, dictationId) => {
    const id = dictationId as string;
    const text =
      (lastResult.id === id ? lastResult.text : null) ??
      findRestorable(id) ??
      history.get(id)?.finalText;
    if (text) clipboard.writeText(text);
  });

  // ---------- History (§5.3) ----------
  handle(
    'history:query',
    z.tuple([
      z.object({
        search: z.string().max(200).optional(),
        before: z.string().optional(),
        limit: z.number().int().min(1).max(200),
      }),
    ]),
    (_e, query) => history.query(query as { search?: string; before?: string; limit: number }),
  );
  handle('history:delete', z.tuple([z.string()]), (_e, id) => history.delete(id as string));
  handle('history:clear', z.tuple([]), () => history.clear());
  handle('history:stats', z.tuple([]), () => history.stats());

  // ---------- Dictation ----------
  handle('dictation:cancel', z.tuple([]), () => controller.cancel());

  // ---------- Shortcut recorder (§2 F29) ----------
  handle('shortcut:beginCapture', z.tuple([]), () => {
    void hotkeys.captureNextChord().then((chord) => {
      const conflict =
        chord && chord === settings.get('commandHotkey') ? 'Command mode shortcut' : null;
      windows.broadcast('shortcut:captured', { chord: chord ?? '', conflict });
    });
  });
  handle('shortcut:cancelCapture', z.tuple([]), () => hotkeys.cancelCapture());

  // ---------- Auth (§11) ----------
  handle('auth:getSession', z.tuple([]), () => auth.getSession());
  handle('auth:sendMagicLink', z.tuple([z.string().email()]), (_e, email) =>
    auth.sendMagicLink(email as string),
  );
  handle('auth:submitMagicCode', z.tuple([z.string().email(), z.string().length(6)]), (_e, email, code) =>
    auth.submitMagicCode(email as string, code as string),
  );
  handle('auth:logout', z.tuple([]), () => auth.logout());

  handle('insertion:undo', z.tuple([]), () => insertion.undo());

  // ---------- Stubs (implemented in later phases; registered so the contract is live) ----------
  handle('rewrite:run', z.tuple([z.string(), z.string()]), () => undefined); // Phase 19
  handle('app:checkForUpdates', z.tuple([]), () => undefined); // Phase 19
}
