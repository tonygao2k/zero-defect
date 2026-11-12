import { app, clipboard, dialog, ipcMain, safeStorage, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { GITHUB_REPO } from '../shared/app-info';
import { BAILIAN, RECOGNITION_MODEL } from '../shared/bailian';
import {
  IPC,
  type Api,
  type ImageHandle,
  type PickedFile,
  type Result,
  type Taxonomy,
} from '../shared/ipc';
import { ConfirmMistakeSchema, ListMistakesSchema } from '../shared/mistakes';
import { normalizePaperTitle } from '../shared/papers';
import { ApiKeyStore } from './api-key';
import { AnalysisError, PaperService } from './ai/paper-service';
import { PracticeService } from './ai/practice-service';
import { MasteryRepo } from './mastery';
import { ping } from './ai/llm-client';
import { openDatabase } from './db/open';
import { electronNormalizer } from './image-normalizer';
import { ImageStore } from './images';
import { MistakeRepo } from './mistakes';
import { PaperRepo } from './papers';
import { SettingsStore } from './settings';
import { checkForUpdate } from './updater';

const IdSchema = z.object({ imageId: z.string().min(1) });
const MistakeIdSchema = z.object({ mistakeId: z.string().min(1) });
const PaperIdSchema = z.object({ paperId: z.string().min(1) });
const SubmitSchema = z.object({
  imageIds: z.array(z.string().min(1)).max(50),
  title: z.string().max(500),
});
const RenameSchema = PaperIdSchema.extend({ title: z.string().max(500) });
const KeySchema = z.object({ key: z.string().max(500) });
const ImportSchema = z.object({
  bytes: z.instanceof(Uint8Array),
});
const ListPapersSchema = z
  .object({ allTerms: z.boolean().optional() })
  .optional();

const SubmitPracticeSchema = z.object({
  sessionId: z.string().min(1),
  answers: z
    .array(
      z.object({ questionId: z.string().min(1), answer: z.string().max(200) }),
    )
    .max(20),
  elapsedMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 3600 * 1000)
    .optional(),
});
const RevisePracticeSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string().max(200),
  giveUp: z.boolean().optional(),
});
const SessionIdSchema = z.object({ sessionId: z.string().min(1) });

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'bmp', 'gif'];

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

/**
 * 旧版本把 Key 用系统钥匙串加密存在文件里。升级后改存数据库(设计文档):
 * 数据库里还没有 Key 时,把旧文件里的 Key 搬过来,然后删除旧文件。
 */
function migrateLegacyKey(userData: string, keys: ApiKeyStore): void {
  const legacy = path.join(userData, 'api-key-qwen.bin');
  try {
    if (!keys.has() && fs.existsSync(legacy)) {
      keys.set(safeStorage.decryptString(fs.readFileSync(legacy)));
    }
  } catch {
    // 钥匙串变更等原因解不开:让家长重新输入即可。
  }
  for (const name of ['api-key-qwen.bin', 'api-key.bin', 'api-key-kimi.bin'])
    fs.rmSync(path.join(userData, name), { force: true });
}

export function registerIpc() {
  const userData = app.getPath('userData');
  const db = openDatabase(path.join(userData, 'zero-defect.sqlite'));
  const repo = new MistakeRepo(db);
  const papers = new PaperRepo(db);
  const apiKey = new ApiKeyStore(db);
  migrateLegacyKey(userData, apiKey);
  const images = new ImageStore(
    path.join(userData, 'tmp-images'),
    path.join(userData, 'images'),
    electronNormalizer,
  );
  images.clearTemp(); // 句柄只存在于内存,上次遗留的临时图片已无法使用。
  const settings = new SettingsStore(path.join(userData, 'settings.json'));
  const service = new PaperService({
    papers,
    repo,
    images,
    getApiKey: () => apiKey.get(),
    getSettings: () => settings.load(),
  });
  service.recoverInterrupted();
  const mastery = new MasteryRepo(db);
  const practice = new PracticeService({
    repo,
    getApiKey: () => apiKey.get(),
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
    result(() => apiKey.set(KeySchema.parse(input).key)),
  );
  handle<'hasApiKey'>(IPC.hasApiKey, async () => apiKey.has());
  handle<'testApiKey'>(IPC.testApiKey, () =>
    result(async () => {
      const key = apiKey.get();
      if (!key) throw new AnalysisError('还没有设置 API Key');
      await ping({
        baseUrl: BAILIAN.baseUrl,
        providerLabel: BAILIAN.shortName,
        apiKey: key,
        model: RECOGNITION_MODEL,
      });
    }),
  );

  // ---- 图片:路径只留在主进程,渲染进程只拿句柄 ----
  const importBuffer = (buffer: Buffer): ImageHandle => {
    const { imageId } = images.import(buffer);
    return { imageId, previewDataUrl: dataUrl(images.read(imageId)) };
  };
  handle<'pickFiles'>(IPC.pickFiles, () =>
    result(async (): Promise<PickedFile[]> => {
      const picked = await dialog.showOpenDialog({
        title: '选择试卷图片或 PDF',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '图片或 PDF', extensions: [...IMAGE_EXTENSIONS, 'pdf'] },
        ],
      });
      if (picked.canceled) return [];
      const files: PickedFile[] = [];
      for (const file of picked.filePaths) {
        const buffer = fs.readFileSync(file);
        if (path.extname(file).toLowerCase() === '.pdf') {
          files.push({
            kind: 'pdf',
            name: path.basename(file),
            bytes: new Uint8Array(buffer),
          });
        } else {
          files.push({ kind: 'image', handle: importBuffer(buffer) });
        }
      }
      return files;
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
  handle<'importImage'>(IPC.importImage, (input) =>
    result(() => importBuffer(Buffer.from(ImportSchema.parse(input).bytes))),
  );
  handle<'discardImage'>(IPC.discardImage, async (input) =>
    images.discard(IdSchema.parse(input).imageId),
  );

  // ---- 试卷 ----
  handle<'submitPaper'>(IPC.submitPaper, (input) =>
    result(() => service.submit(SubmitSchema.parse(input))),
  );
  handle<'listPapers'>(IPC.listPapers, async (input) => {
    const s = settings.load();
    return papers.list(
      { grade: s.grade, semester: s.semester },
      ListPapersSchema.parse(input)?.allTerms === true,
    );
  });
  handle<'renamePaper'>(IPC.renamePaper, (input) =>
    result(() => {
      const { paperId, title } = RenameSchema.parse(input);
      papers.rename(paperId, normalizePaperTitle(title));
    }),
  );
  handle<'deletePaper'>(IPC.deletePaper, (input) =>
    result(() => service.deletePaper(PaperIdSchema.parse(input).paperId)),
  );
  handle<'retryPaper'>(IPC.retryPaper, (input) =>
    result(() => service.retry(PaperIdSchema.parse(input).paperId)),
  );
  handle<'confirmPaper'>(IPC.confirmPaper, (input) =>
    result(() => repo.confirmAllInPaper(PaperIdSchema.parse(input).paperId)),
  );

  // ---- 错题 ----
  handle<'getMistake'>(IPC.getMistake, (input) =>
    result(() => {
      const detail = repo.getDetail(MistakeIdSchema.parse(input).mistakeId);
      const { imagePaths, ...rest } = detail;
      return {
        ...rest,
        imageDataUrls: imagePaths
          .filter((p) => fs.existsSync(p))
          .map((p) => dataUrl(fs.readFileSync(p))),
      };
    }),
  );
  handle<'confirmMistake'>(IPC.confirmMistake, (input) =>
    result(() => repo.confirm(ConfirmMistakeSchema.parse(input))),
  );
  handle<'confirmRecommended'>(IPC.confirmRecommended, (input) =>
    result(() => ({
      confirmed: repo.confirmRecommended(
        MistakeIdSchema.parse(input).mistakeId,
      ),
    })),
  );
  handle<'deleteMistake'>(IPC.deleteMistake, (input) =>
    result(() => repo.delete(MistakeIdSchema.parse(input).mistakeId)),
  );
  handle<'listMistakes'>(IPC.listMistakes, async (input) =>
    repo.list(ListMistakesSchema.parse(input) ?? {}),
  );

  handle<'getTaxonomy'>(IPC.getTaxonomy, async () => {
    const s = settings.load();
    const taxonomy: Taxonomy = {
      causes: repo.listActiveCauses(),
      knowledgePoints: repo.knowledgePointsFor(s.curriculumId, s.grade),
    };
    return taxonomy;
  });

  // ---- 首页统计与智能练习 ----
  handle<'getHomeStats'>(IPC.getHomeStats, async () => {
    const s = settings.load();
    return mastery.homeStats({ grade: s.grade, semester: s.semester });
  });
  handle<'startPractice'>(IPC.startPractice, () =>
    result(() => practice.start()),
  );
  handle<'submitPractice'>(IPC.submitPractice, (input) =>
    result(() => practice.submit(SubmitPracticeSchema.parse(input))),
  );
  handle<'revisePractice'>(IPC.revisePractice, (input) =>
    result(() => practice.revise(RevisePracticeSchema.parse(input))),
  );
  handle<'finishPractice'>(IPC.finishPractice, (input) =>
    result(() => practice.finish(SessionIdSchema.parse(input).sessionId)),
  );
}
