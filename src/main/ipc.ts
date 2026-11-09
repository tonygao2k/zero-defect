import { app, ipcMain, shell } from 'electron';
import { GITHUB_REPO } from '../shared/app-info';
import { IPC } from '../shared/ipc';
import { checkForUpdate } from './updater';

export function registerIpc() {
  ipcMain.handle(IPC.getAppVersion, () => app.getVersion());
  ipcMain.handle(IPC.checkForUpdate, () => checkForUpdate());
  ipcMain.handle(IPC.openReleasePage, () =>
    shell.openExternal(`https://github.com/${GITHUB_REPO}/releases/latest`),
  );
}
