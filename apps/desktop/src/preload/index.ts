import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { FlowBridge } from '@flow/shared';

/**
 * Full bridge for the main window. Channel names are constrained to the
 * `domain:action` shape here; real authorization happens in the main process
 * (only registered handlers exist, senders are verified).
 */
const CHANNEL_PATTERN = /^[a-z]+:[a-zA-Z]+$/;

function assertChannel(channel: string): void {
  if (!CHANNEL_PATTERN.test(channel)) {
    throw new Error(`Invalid IPC channel: ${channel}`);
  }
}

const bridge: FlowBridge = {
  invoke: (channel, ...args) => {
    assertChannel(channel);
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, listener) => {
    assertChannel(channel);
    const wrapped = (_event: IpcRendererEvent, payload: unknown) =>
      (listener as (p: unknown) => void)(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld('flow', bridge);

// Relay the audio MessagePort from main into the page (Electron's documented
// pattern — ports can't cross the context bridge directly).
ipcRenderer.on('flow:audio-port', (event) => {
  window.postMessage('flow:audio-port', '*', event.ports);
});
