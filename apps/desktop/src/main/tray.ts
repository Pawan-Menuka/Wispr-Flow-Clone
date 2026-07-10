import path from 'node:path';
import { Menu, Tray, app, nativeImage } from 'electron';
import type { WindowManager } from './windows';
import type { AudioBridge } from './services/audio-bridge';
import type { DictationController } from './dictation/controller';
import type { SettingsStore } from './services/settings-store';
import { runDemoDictation } from './dictation/demo';
import { runMicCheck } from './dictation/mic-check';

let tray: Tray | null = null;

const LANGUAGES: [code: string, label: string][] = [
  ['auto', 'Auto-detect'],
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['hi', 'Hindi'],
  ['ja', 'Japanese'],
];

export function createTray(
  windows: WindowManager,
  audio: AudioBridge,
  controller: DictationController,
  settings: SettingsStore,
): Tray {
  const iconPath = path.join(resourcesDir(), 'tray.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Flow');

  const rebuild = () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Start / stop dictation', click: () => controller.toggle() },
      { label: 'Demo dictation', click: () => void runDemoDictation(windows) },
      { label: 'Mic check (5 s)', click: () => void runMicCheck(windows, audio) },
      {
        label: 'Language',
        submenu: LANGUAGES.map(([code, label]) => ({
          label,
          type: 'radio' as const,
          checked: settings.get('language') === code,
          click: () => settings.set('language', code),
        })),
      },
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
    tray!.setContextMenu(menu);
  };

  rebuild();
  settings.onChange((patch) => {
    if (patch.language !== undefined) rebuild();
  });
  tray.on('click', () => windows.showMainWindow());
  return tray;
}

function resourcesDir(): string {
  return app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), 'resources');
}
