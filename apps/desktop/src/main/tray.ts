import path from 'node:path';
import { Menu, Tray, app, nativeImage } from 'electron';
import type { WindowManager } from './windows';
import type { AudioBridge } from './services/audio-bridge';
import type { DictationController } from './dictation/controller';
import { runDemoDictation } from './dictation/demo';
import { runMicCheck } from './dictation/mic-check';

let tray: Tray | null = null;

export function createTray(
  windows: WindowManager,
  audio: AudioBridge,
  controller: DictationController,
): Tray {
  const iconPath = path.join(resourcesDir(), 'tray.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Flow');

  const menu = Menu.buildFromTemplate([
    { label: 'Start / stop dictation', click: () => controller.toggle() },
    { label: 'Demo dictation', click: () => void runDemoDictation(windows) },
    { label: 'Mic check (5 s)', click: () => void runMicCheck(windows, audio) },
    { type: 'separator' },
    { label: 'Open Flow', click: () => windows.showMainWindow() },
    { label: 'Check for updates', enabled: false },
    { type: 'separator' },
    {
      label: 'Quit Flow',
      click: () => {
        windows.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => windows.showMainWindow());
  return tray;
}

function resourcesDir(): string {
  return app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), 'resources');
}
