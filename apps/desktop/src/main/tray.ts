import path from 'node:path';
import { Menu, Tray, app, nativeImage } from 'electron';
import type { WindowManager } from './windows';

let tray: Tray | null = null;

export function createTray(windows: WindowManager): Tray {
  const iconPath = path.join(resourcesDir(), 'tray.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Flow');

  const menu = Menu.buildFromTemplate([
    { label: 'Start dictation', enabled: false, toolTip: 'Coming in Phase 5' },
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
