import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type Api } from './shared/ipc';

// 只暴露白名单里的明确接口,渲染进程拿不到 ipcRenderer 本身。
const api: Api = {
  getAppVersion: () => ipcRenderer.invoke(IPC.getAppVersion),
  checkForUpdate: () => ipcRenderer.invoke(IPC.checkForUpdate),
  openReleasePage: () => ipcRenderer.invoke(IPC.openReleasePage),
};

contextBridge.exposeInMainWorld('api', api);
