import type { Settings } from './settings.js';
import type { Entitlements } from './entitlements.js';
import type { ErrorKind } from './errors.js';
import type {
  DictationState,
  DictionaryTerm,
  HistoryPage,
  HistoryStats,
  SessionInfo,
  SyncStatus,
  UndoResult,
  UpdateStatus,
} from './types.js';

/**
 * Typed IPC contract between renderer(s) and the Electron main process
 * (BLUEPRINT §7.3). The preload exposes exactly this surface as `window.flow`.
 * Payloads are zod-validated at the main-process boundary.
 */

/** invoke (renderer → main, promise-returning) */
export interface FlowInvoke {
  'auth:getSession': () => SessionInfo | null;
  'auth:startOAuth': (provider: 'google' | 'apple') => void;
  'auth:sendMagicLink': (email: string) => void;
  'auth:submitMagicCode': (email: string, code: string) => SessionInfo;
  'auth:logout': () => void;

  'settings:get': () => Settings;
  'settings:set': <K extends keyof Settings>(key: K, value: Settings[K]) => void;

  'history:query': (q: { search?: string; before?: string; limit: number }) => HistoryPage;
  'history:delete': (id: string) => void;
  'history:clear': () => void;
  'history:stats': () => HistoryStats;

  'dictionary:list': () => DictionaryTerm[];
  'dictionary:add': (phrase: string, hint?: string) => void;
  'dictionary:remove': (phrase: string) => void;

  'dictation:cancel': () => void;
  'insertion:undo': () => UndoResult;
  'rewrite:run': (dictationId: string, instruction: string) => void;
  /** Copy a finished dictation's text (overlay Copy chip / restore stack). */
  'clipboard:copyResult': (dictationId: string) => void;

  'shortcut:beginCapture': () => void;
  'shortcut:cancelCapture': () => void;

  'models:download': (model: string) => void;
  'models:delete': (model: string) => void;

  'app:openExternal': (url: string) => void; // main validates against allowlist
  'app:openLogsFolder': () => void;
  'app:checkForUpdates': () => void;
  'app:installUpdate': () => void;
  'app:exportDiagnostics': () => string; // returns zip path
  'app:getVersion': () => string;
}

/** events (main → renderer, subscription-based) */
export interface FlowEvents {
  'dictation:state': DictationState;
  'dictation:interim': { text: string; stableWords: number };
  'dictation:result': { id: string; text: string; appName: string | null };
  'dictation:error': { kind: ErrorKind; message: string; rawText?: string };
  /** ~30 Hz while listening; overlay waveform only. */
  'audio:level': { rms: number };
  /** Main asks the hidden renderer to start/stop mic capture (§13.1). */
  'audio:capture': { active: boolean };
  'settings:changed': Partial<Settings>;
  'session:changed': SessionInfo | null;
  'sync:status': SyncStatus;
  'subscription:updated': Entitlements;
  'update:status': UpdateStatus;
  'models:progress': { model: string; pct: number };
  'shortcut:captured': { chord: string; conflict: string | null };
}

export type InvokeChannel = keyof FlowInvoke;
export type EventChannel = keyof FlowEvents;

/** The bridge surface exposed by preload as `window.flow`. */
export interface FlowBridge {
  invoke<K extends InvokeChannel>(
    channel: K,
    ...args: Parameters<FlowInvoke[K]>
  ): Promise<Awaited<ReturnType<FlowInvoke[K]>>>;
  on<K extends EventChannel>(channel: K, listener: (payload: FlowEvents[K]) => void): () => void;
}

/**
 * The overlay window gets a reduced bridge — state display + chip actions only.
 * It must never see auth, settings mutation, or history surfaces.
 */
export const OVERLAY_INVOKE_ALLOWLIST = [
  'dictation:cancel',
  'insertion:undo',
  'rewrite:run',
  'clipboard:copyResult',
] as const satisfies readonly InvokeChannel[];

export const OVERLAY_EVENT_ALLOWLIST = [
  'dictation:state',
  'dictation:interim',
  'dictation:result',
  'dictation:error',
  'audio:level',
] as const satisfies readonly EventChannel[];
