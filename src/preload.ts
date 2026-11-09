import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type Api } from './shared/ipc';

const call = (channel: string) => (input?: unknown) =>
  ipcRenderer.invoke(channel, input);

// 只暴露白名单里的明确接口,渲染进程拿不到 ipcRenderer 本身。
const api: Api = {
  getAppVersion: call(IPC.getAppVersion),
  checkForUpdate: call(IPC.checkForUpdate),
  openReleasePage: call(IPC.openReleasePage),
  getSettings: call(IPC.getSettings),
  saveSettings: call(IPC.saveSettings),
  setApiKey: call(IPC.setApiKey),
  getKeyStatus: call(IPC.getKeyStatus),
  testApiKey: call(IPC.testApiKey),
  pickImage: call(IPC.pickImage),
  pasteImage: call(IPC.pasteImage),
  discardImage: call(IPC.discardImage),
  analyzeMistake: call(IPC.analyzeMistake),
  getMistake: call(IPC.getMistake),
  confirmMistake: call(IPC.confirmMistake),
  skipAttribution: call(IPC.skipAttribution),
  discardDraft: call(IPC.discardDraft),
  listMistakes: call(IPC.listMistakes),
  getTaxonomy: call(IPC.getTaxonomy),
};

contextBridge.exposeInMainWorld('api', api);
