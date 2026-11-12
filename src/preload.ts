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
  hasApiKey: call(IPC.hasApiKey),
  testApiKey: call(IPC.testApiKey),
  pickFiles: call(IPC.pickFiles),
  pasteImage: call(IPC.pasteImage),
  importImage: call(IPC.importImage),
  discardImage: call(IPC.discardImage),
  submitPaper: call(IPC.submitPaper),
  listPapers: call(IPC.listPapers),
  renamePaper: call(IPC.renamePaper),
  deletePaper: call(IPC.deletePaper),
  retryPaper: call(IPC.retryPaper),
  confirmPaper: call(IPC.confirmPaper),
  getMistake: call(IPC.getMistake),
  confirmMistake: call(IPC.confirmMistake),
  confirmRecommended: call(IPC.confirmRecommended),
  deleteMistake: call(IPC.deleteMistake),
  listMistakes: call(IPC.listMistakes),
  getTaxonomy: call(IPC.getTaxonomy),
  getHomeStats: call(IPC.getHomeStats),
  startPractice: call(IPC.startPractice),
  submitPractice: call(IPC.submitPractice),
  revisePractice: call(IPC.revisePractice),
  finishPractice: call(IPC.finishPractice),
};

contextBridge.exposeInMainWorld('api', api);
