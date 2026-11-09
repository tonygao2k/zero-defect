import { app, clipboard, dialog, ipcMain, safeStorage, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { GITHUB_REPO } from '../shared/app-info';
import {
  IPC,
  type Api,
  type ImageHandle,
  type Result,
  type Taxonomy,
} from '../shared/ipc';
import { ConfirmMistakeSchema, EditableFieldsSchema } from '../shared/mistakes';
import {
  PROVIDERS,
  PROVIDER_IDS,
  ProviderIdSchema,
  type ProviderId,
} from '../shared/providers';
import { AnalysisError, AnalysisService } from './ai/analysis-service';
import { ping } from './ai/llm-client';
import { openDatabase } from './db/open';
import { electronNormalizer } from './image-normalizer';
import { ImageStore } from './images';
import { MistakeRepo } from './mistakes';
import { ApiKeyStore, type Encryptor } from './secrets';
import { SettingsStore } from './settings';
import { checkForUpdate } from './updater';

const IdSchema = z.object({ imageId: z.string().min(1) });
// 说明的长度上限在 AnalysisService 里检查并给出中文提示,这里只防止异常大的输入。
const AnalyzeSchema = IdSchema.extend({
  hint: z.string().max(2000).optional(),
});
const MistakeIdSchema = z.object({ mistakeId: z.string().min(1) });
const ListSchema = z
  .object({
    status: z.enum(['draft', 'active', 'unattributed', 'archived']).optional(),
  })
  .optional();
const KeySchema = z.object({
  provider: ProviderIdSchema,
  key: z.string().max(500),
});
const TestSchema = z.object({
  provider: ProviderIdSchema,
  model: z.string().trim().min(1).max(100),
});

/** 把异常转成可展示的中文消息。只放行我们自己抛出的、已经是中文的错误。 */
function toMessage(error: unknown): string {
  if (error instanceof AnalysisError) return error.message;
  if (error instanceof z.ZodError)
    return error.issues[0]?.message || '输入不合法';
  if (error instanceof Error && /[一-鿿]/.test(error.message))
    return error.message;
  console.error('[ipc] unexpected error:', error);
  return '操作失败,请重试';
}

async function result<T>(fn: () => T | Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

const dataUrl = (jpeg: Buffer) =>
  `data:image/jpeg;base64,${jpeg.toString('base64')}`;

export function registerIpc() {
  const userData = app.getPath('userData');
  const repo = new MistakeRepo(
    openDatabase(path.join(userData, 'zero-defect.sqlite')),
  );
  const images = new ImageStore(
    path.join(userData, 'tmp-images'),
    path.join(userData, 'images'),
    electronNormalizer,
  );
  images.clearTemp(); // 句柄只存在于内存,上次遗留的临时图片已无法使用。
  const settings = new SettingsStore(path.join(userData, 'settings.json'));
  const encryptor: Encryptor = {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data),
  };
  // 每个服务商一份密钥,互不干扰。
  const apiKeys = Object.fromEntries(
    PROVIDER_IDS.map((id) => [
      id,
      new ApiKeyStore(path.join(userData, `api-key-${id}.bin`), encryptor),
    ]),
  ) as Record<ProviderId, ApiKeyStore>;
  // 旧版本(OpenRouter)留下的密钥不再使用,直接删除。
  fs.rmSync(path.join(userData, 'api-key.bin'), { force: true });
  // 已移除的服务商(Kimi)留下的密钥同样删除。
  fs.rmSync(path.join(userData, 'api-key-kimi.bin'), { force: true });
  const analysis = new AnalysisService({
    repo,
    images,
    getApiKey: (provider) => apiKeys[provider].get(),
    getSettings: () => settings.load(),
  });

  // 类型约束:每个通道的处理函数返回值必须与 Api 里的声明一致。
  const handle = <K extends keyof Api>(
    channel: string,
    fn: (input: unknown) => ReturnType<Api[K]>,
  ) => ipcMain.handle(channel, (_event, input) => fn(input));

  handle<'getAppVersion'>(IPC.getAppVersion, async () => app.getVersion());
  handle<'checkForUpdate'>(IPC.checkForUpdate, () => checkForUpdate());
  handle<'openReleasePage'>(IPC.openReleasePage, () =>
    shell.openExternal(`https://github.com/${GITHUB_REPO}/releases/latest`),
  );

  // ---- 设置与密钥 ----
  handle<'getSettings'>(IPC.getSettings, async () => settings.load());
  handle<'saveSettings'>(IPC.saveSettings, (input) =>
    result(() => settings.save(input)),
  );
  handle<'setApiKey'>(IPC.setApiKey, (input) =>
    result(() => {
      const { provider, key } = KeySchema.parse(input);
      apiKeys[provider].set(key);
    }),
  );
  handle<'getKeyStatus'>(
    IPC.getKeyStatus,
    async () =>
      Object.fromEntries(
        PROVIDER_IDS.map((id) => [id, apiKeys[id].has()]),
      ) as Record<ProviderId, boolean>,
  );
  handle<'testApiKey'>(IPC.testApiKey, (input) =>
    result(async () => {
      const { provider, model } = TestSchema.parse(input);
      const key = apiKeys[provider].get();
      if (!key) throw new AnalysisError('还没有设置这个服务商的 API Key');
      const p = PROVIDERS[provider];
      await ping({
        baseUrl: p.baseUrl,
        providerLabel: p.shortName,
        apiKey: key,
        model,
      });
    }),
  );

  // ---- 图片:路径只留在主进程,渲染进程只拿句柄 ----
  const importBuffer = (buffer: Buffer): ImageHandle => {
    const { imageId } = images.import(buffer);
    return { imageId, previewDataUrl: dataUrl(images.read(imageId)) };
  };
  handle<'pickImage'>(IPC.pickImage, () =>
    result(async () => {
      const picked = await dialog.showOpenDialog({
        title: '选择错题照片',
        properties: ['openFile'],
        filters: [
          {
            name: '图片',
            extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'bmp', 'gif'],
          },
        ],
      });
      if (picked.canceled || picked.filePaths.length === 0) return null;
      return importBuffer(fs.readFileSync(picked.filePaths[0]));
    }),
  );
  handle<'pasteImage'>(IPC.pasteImage, () =>
    result(async () => {
      // Electron 45 的剪贴板是异步 W3C 风格接口:先找到图片条目,再取出 Blob。
      for (const item of await clipboard.read()) {
        const mime = item.types.find((t) => t.startsWith('image/'));
        if (!mime) continue;
        const blob = await item.getType(mime);
        if (!(blob instanceof Blob)) continue;
        return importBuffer(Buffer.from(await blob.arrayBuffer()));
      }
      throw new AnalysisError('剪贴板里没有图片,请先截图或复制一张图片');
    }),
  );
  handle<'discardImage'>(IPC.discardImage, async (input) =>
    images.discard(IdSchema.parse(input).imageId),
  );

  // ---- 错题 ----
  handle<'analyzeMistake'>(IPC.analyzeMistake, (input) =>
    result(async () => {
      const { imageId, hint } = AnalyzeSchema.parse(input);
      const out = await analysis.analyze(imageId, hint);
      return out.kind === 'ok'
        ? {
            kind: 'ok' as const,
            mistakeIds: out.mistakes.map((m) => m.mistakeId),
            skipped: out.skipped,
            ignoredCorrect: out.ignoredCorrect,
          }
        : out;
    }),
  );
  handle<'getMistake'>(IPC.getMistake, (input) =>
    result(() => {
      const detail = repo.getDetail(MistakeIdSchema.parse(input).mistakeId);
      let imageDataUrl: string | null = null;
      if (detail.imagePath && fs.existsSync(detail.imagePath)) {
        imageDataUrl = dataUrl(fs.readFileSync(detail.imagePath));
      }
      const { imagePath: _omit, ...rest } = detail;
      return { ...rest, imageDataUrl };
    }),
  );
  handle<'confirmMistake'>(IPC.confirmMistake, (input) =>
    result(() => repo.confirm(ConfirmMistakeSchema.parse(input))),
  );
  handle<'skipAttribution'>(IPC.skipAttribution, (input) =>
    result(() => repo.skip(EditableFieldsSchema.parse(input))),
  );
  handle<'discardDraft'>(IPC.discardDraft, (input) =>
    result(() =>
      images.removeStored(
        repo.discardDraft(MistakeIdSchema.parse(input).mistakeId),
      ),
    ),
  );
  handle<'listMistakes'>(IPC.listMistakes, async (input) =>
    repo.list(ListSchema.parse(input)?.status),
  );

  handle<'getTaxonomy'>(IPC.getTaxonomy, async () => {
    const s = settings.load();
    const taxonomy: Taxonomy = {
      causes: repo.listActiveCauses(),
      knowledgePoints: repo.knowledgePointsFor(s.curriculumId, s.grade),
    };
    return taxonomy;
  });
}
