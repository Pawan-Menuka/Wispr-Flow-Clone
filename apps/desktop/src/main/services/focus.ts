/**
 * Focused-app detection (BLUEPRINT §14.2), Windows-first via koffi FFI —
 * GetForegroundWindow → pid → QueryFullProcessImageNameW. Microsecond-fast,
 * called synchronously at chord-down. Returns the lowercase process name
 * only: window titles are never read (privacy rule, §15).
 *
 * macOS (NSWorkspace) and the writable/secure-field probes (UIA/AX) come
 * with the native-addon pass; on non-Windows this returns null.
 */

interface Win32Api {
  GetForegroundWindow: () => unknown;
  GetWindowThreadProcessId: (hwnd: unknown, pid: number[]) => number;
  OpenProcess: (access: number, inherit: boolean, pid: number) => unknown;
  QueryFullProcessImageNameW: (
    handle: unknown,
    flags: number,
    buffer: Buffer,
    size: number[],
  ) => boolean;
  CloseHandle: (handle: unknown) => boolean;
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

let api: Win32Api | null = null;
let loadFailed = false;

function loadApi(): Win32Api | null {
  if (api || loadFailed) return api;
  if (process.platform !== 'win32') {
    loadFailed = true;
    return null;
  }
  try {
    // Lazy require: koffi is a native module; failure must not break boot.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    api = {
      GetForegroundWindow: user32.func('void* __stdcall GetForegroundWindow()'),
      GetWindowThreadProcessId: user32.func(
        'uint32 __stdcall GetWindowThreadProcessId(void*, _Out_ uint32*)',
      ),
      OpenProcess: kernel32.func('void* __stdcall OpenProcess(uint32, bool, uint32)'),
      QueryFullProcessImageNameW: kernel32.func(
        'bool __stdcall QueryFullProcessImageNameW(void*, uint32, void*, _Inout_ uint32*)',
      ),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(void*)'),
    } as unknown as Win32Api;
  } catch (err) {
    console.warn('[focus] koffi unavailable:', err instanceof Error ? err.message : err);
    loadFailed = true;
  }
  return api;
}

export interface FocusedApp {
  /** Lowercase executable name, e.g. "slack.exe". */
  processName: string;
}

export function getFocusedApp(): FocusedApp | null {
  const win32 = loadApi();
  if (!win32) return null;
  try {
    const hwnd = win32.GetForegroundWindow();
    if (!hwnd) return null;
    const pidOut = [0];
    win32.GetWindowThreadProcessId(hwnd, pidOut);
    const pid = pidOut[0]!;
    if (!pid) return null;

    const handle = win32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!handle) return null;
    try {
      const buffer = Buffer.alloc(2 * 1024); // utf16 path, MAX_PATH-ish
      const size = [1024];
      if (!win32.QueryFullProcessImageNameW(handle, 0, buffer, size)) return null;
      const fullPath = buffer.toString('utf16le', 0, size[0]! * 2);
      const processName = fullPath.split(/[\\/]/).pop()?.toLowerCase() ?? '';
      return processName ? { processName } : null;
    } finally {
      win32.CloseHandle(handle);
    }
  } catch {
    return null;
  }
}
