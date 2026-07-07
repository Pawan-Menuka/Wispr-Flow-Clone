import { capture } from './capture';

/**
 * Connects the capture controller to the app: receives the audio MessagePort
 * from the main process (relayed by the preload as a window message), obeys
 * `audio:capture` start/stop events, and follows mic/VAD settings live.
 */
export function wireAudio(): void {
  window.addEventListener('message', (event) => {
    if (event.data === 'flow:audio-port' && event.ports[0]) {
      console.warn('[audio-wire] port attached');
      capture.attachMainPort(event.ports[0]);
    }
  });

  window.flow.on('audio:capture', ({ active }) => {
    console.warn(`[audio-wire] capture ${active ? 'start' : 'stop'} requested`);
    if (active) {
      void window.flow
        .invoke('settings:get')
        .then((settings) => {
          capture.setSensitivity(settings.vadSensitivity);
          return capture.start(settings.micDeviceId);
        })
        .catch((err: unknown) => {
          console.warn('[audio-wire] capture failed:', err);
        });
    } else {
      void capture.stop();
    }
  });

  window.flow.on('settings:changed', (patch) => {
    if (patch.vadSensitivity !== undefined) capture.setSensitivity(patch.vadSensitivity);
    if (patch.micDeviceId !== undefined && capture.isActive) {
      void capture.restart(patch.micDeviceId);
    }
  });
}
