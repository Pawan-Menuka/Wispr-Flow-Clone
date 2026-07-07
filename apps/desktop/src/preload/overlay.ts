import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { FlowBridge } from '@flow/shared';
import { OVERLAY_EVENT_ALLOWLIST, OVERLAY_INVOKE_ALLOWLIST } from '@flow/shared';

/**
 * Reduced bridge for the overlay window (BLUEPRINT §7.3): dictation state,
 * interims, audio levels, and chip actions only. Enforced both here and in
 * the main process.
 */
const bridge: FlowBridge = {
  invoke: (channel, ...args) => {
    if (!(OVERLAY_INVOKE_ALLOWLIST as readonly string[]).includes(channel)) {
      throw new Error(`Channel ${channel} not available in overlay`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, listener) => {
    if (!(OVERLAY_EVENT_ALLOWLIST as readonly string[]).includes(channel)) {
      throw new Error(`Event ${channel} not available in overlay`);
    }
    const wrapped = (_event: IpcRendererEvent, payload: unknown) =>
      (listener as (p: unknown) => void)(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld('flow', bridge);
