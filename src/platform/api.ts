import { invoke } from '@tauri-apps/api/core';
import type { Api, PickedFile, Result } from '../shared/ipc';

// Keep UI contracts stable; credentials, persistence, and AI execute in Rust.
const call = <K extends keyof Api>(method: K, input?: unknown) =>
  invoke('backend', { method, input: input ?? null }) as ReturnType<Api[K]>;

export const api: Api = {
  getAppVersion: (...args: Parameters<Api['getAppVersion']>) =>
    call('getAppVersion', (args as unknown[])[0]),
  getAiConfig: (...args: Parameters<Api['getAiConfig']>) =>
    call('getAiConfig', (args as unknown[])[0]),
  checkForUpdate: (...args: Parameters<Api['checkForUpdate']>) =>
    call('checkForUpdate', (args as unknown[])[0]),
  openReleasePage: (...args: Parameters<Api['openReleasePage']>) =>
    call('openReleasePage', (args as unknown[])[0]),
  getSettings: (...args: Parameters<Api['getSettings']>) =>
    call('getSettings', (args as unknown[])[0]),
  saveSettings: (...args: Parameters<Api['saveSettings']>) =>
    call('saveSettings', (args as unknown[])[0]),
  setApiKey: (...args: Parameters<Api['setApiKey']>) =>
    call('setApiKey', (args as unknown[])[0]),
  hasApiKey: (...args: Parameters<Api['hasApiKey']>) =>
    call('hasApiKey', (args as unknown[])[0]),
  testApiKey: (...args: Parameters<Api['testApiKey']>) =>
    call('testApiKey', (args as unknown[])[0]),
  pickFiles: async () => {
    const result: Result<PickedFile[]> = await call('pickFiles');
    if (result.ok)
      for (const file of result.value) {
        if (file.kind === 'pdf') file.bytes = Uint8Array.from(file.bytes);
      }
    return result;
  },
  pasteImage: (...args: Parameters<Api['pasteImage']>) =>
    call('pasteImage', (args as unknown[])[0]),
  importImage: ({ bytes }) => call('importImage', { bytes: Array.from(bytes) }),
  discardImage: (...args: Parameters<Api['discardImage']>) =>
    call('discardImage', (args as unknown[])[0]),
  submitPaper: (...args: Parameters<Api['submitPaper']>) =>
    call('submitPaper', (args as unknown[])[0]),
  listPapers: (...args: Parameters<Api['listPapers']>) =>
    call('listPapers', (args as unknown[])[0]),
  renamePaper: (...args: Parameters<Api['renamePaper']>) =>
    call('renamePaper', (args as unknown[])[0]),
  deletePaper: (...args: Parameters<Api['deletePaper']>) =>
    call('deletePaper', (args as unknown[])[0]),
  retryPaper: (...args: Parameters<Api['retryPaper']>) =>
    call('retryPaper', (args as unknown[])[0]),
  confirmPaper: (...args: Parameters<Api['confirmPaper']>) =>
    call('confirmPaper', (args as unknown[])[0]),
  getMistake: (...args: Parameters<Api['getMistake']>) =>
    call('getMistake', (args as unknown[])[0]),
  confirmMistake: (...args: Parameters<Api['confirmMistake']>) =>
    call('confirmMistake', (args as unknown[])[0]),
  confirmRecommended: (...args: Parameters<Api['confirmRecommended']>) =>
    call('confirmRecommended', (args as unknown[])[0]),
  deleteMistake: (...args: Parameters<Api['deleteMistake']>) =>
    call('deleteMistake', (args as unknown[])[0]),
  listMistakes: (...args: Parameters<Api['listMistakes']>) =>
    call('listMistakes', (args as unknown[])[0]),
  getTaxonomy: (...args: Parameters<Api['getTaxonomy']>) =>
    call('getTaxonomy', (args as unknown[])[0]),
  getHomeStats: (...args: Parameters<Api['getHomeStats']>) =>
    call('getHomeStats', (args as unknown[])[0]),
  startPractice: (...args: Parameters<Api['startPractice']>) =>
    call('startPractice', (args as unknown[])[0]),
  submitPractice: (...args: Parameters<Api['submitPractice']>) =>
    call('submitPractice', (args as unknown[])[0]),
  getPracticeResult: (input) => call('getPracticeResult', input),
  requestPracticeHint: (input) => call('requestPracticeHint', input),
  revisePractice: (...args: Parameters<Api['revisePractice']>) =>
    call('revisePractice', (args as unknown[])[0]),
  reportPracticeQuestion: (input) => call('reportPracticeQuestion', input),
  listPracticeReviews: (...args: Parameters<Api['listPracticeReviews']>) =>
    call('listPracticeReviews', (args as unknown[])[0]),
  resolvePracticeReview: (input) => call('resolvePracticeReview', input),
  finishPractice: (...args: Parameters<Api['finishPractice']>) =>
    call('finishPractice', (args as unknown[])[0]),
  abandonPractice: (input) => call('abandonPractice', input),
};
