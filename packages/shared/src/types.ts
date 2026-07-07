import type { Entitlements } from './entitlements.js';
import type { ErrorKind } from './errors.js';

/** Auth session as exposed to the renderer (tokens stay in the main process). */
export interface SessionInfo {
  user: UserProfile;
  device: DeviceInfo;
  entitlements: Entitlements;
  quota: QuotaInfo;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface DeviceInfo {
  id: string;
  name: string;
  platform: 'win32' | 'darwin' | 'linux';
  appVersion: string;
  lastSeenAt: string;
  current?: boolean;
}

export interface QuotaInfo {
  usedWords: number;
  /** null = unlimited. */
  limitWords: number | null;
  resetsAt: string;
}

/** Dictation pipeline state driving the overlay (BLUEPRINT §3.1). */
export type DictationPhase =
  | 'idle'
  | 'armed'
  | 'listening'
  | 'processing'
  | 'inserting'
  | 'confirmed'
  | 'error';

export interface DictationState {
  phase: DictationPhase;
  sessionId?: string;
  mode?: 'dictate' | 'command';
  offline?: boolean;
  error?: { kind: ErrorKind; message: string };
}

export interface HistoryEntry {
  id: string;
  finalText: string;
  appName: string | null;
  language: string;
  wordCount: number;
  durationMs: number;
  createdAt: string;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  /** Cursor for the next page (createdAt of last row), or null when exhausted. */
  nextBefore: string | null;
}

export interface UndoResult {
  ok: boolean;
  method?: 'synthetic-undo' | 'select-delete' | 'none';
  message?: string;
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'downloading'; pct: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

export type SyncStatus = 'synced' | 'pending' | 'offline';
