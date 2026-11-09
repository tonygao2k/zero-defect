import type { AnalysisResult } from './analysis';
import type {
  ConfirmMistakeInput,
  EditableFields,
  MistakeStatus,
  MistakeSummary,
} from './mistakes';
import type { ProviderId } from './providers';
import type { Settings } from './settings';

/** IPC 通道名,主进程和预加载脚本共用,避免两边拼写不一致。 */
export const IPC = {
  getAppVersion: 'app:getVersion',
  checkForUpdate: 'update:check',
  openReleasePage: 'update:openReleasePage',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  setApiKey: 'settings:setApiKey',
  getKeyStatus: 'settings:getKeyStatus',
  testApiKey: 'settings:testApiKey',
  pickImage: 'image:pick',
  pasteImage: 'image:paste',
  discardImage: 'image:discard',
  analyzeMistake: 'mistake:analyze',
  getMistake: 'mistake:get',
  confirmMistake: 'mistake:confirm',
  skipAttribution: 'mistake:skip',
  discardDraft: 'mistake:discardDraft',
  listMistakes: 'mistake:list',
  getTaxonomy: 'taxonomy:get',
} as const;

export type UpdateCheckResult =
  | { status: 'update_available'; current: string; latest: string }
  | { status: 'up_to_date'; current: string }
  | { status: 'no_release'; current: string }
  | { status: 'error'; current: string; message: string };

/** 可能失败的调用统一返回 Result,错误消息是可直接展示给家长的中文。 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type ImageHandle = { imageId: string; previewDataUrl: string };

/** 一次分析可能得到多道错题。完整内容用 getMistake 逐道读取。 */
export type AnalyzeResponse =
  | {
      kind: 'ok';
      mistakeIds: string[];
      skipped: number;
      ignoredCorrect: number;
    }
  | { kind: 'duplicate'; mistakeIds: string[]; pendingIds: string[] };

export type MistakeDetail = {
  id: string;
  status: MistakeStatus;
  imageDataUrl: string | null;
  fields: Omit<EditableFields, 'mistakeId'>;
  analysis: AnalysisResult | null;
};

export type Taxonomy = {
  causes: { code: string; label: string; description: string }[];
  knowledgePoints: {
    code: string;
    label: string;
    grade: number | null;
    semester: number | null;
  }[];
};

/** 渲染进程能调用的全部能力。不传路径、不传 URL,只有无参数或句柄式接口。 */
export type Api = {
  getAppVersion(): Promise<string>;
  checkForUpdate(): Promise<UpdateCheckResult>;
  /** 用系统浏览器打开本项目的最新发布页,地址由主进程固定,渲染进程不能指定。 */
  openReleasePage(): Promise<void>;

  getSettings(): Promise<Settings>;
  saveSettings(input: Settings): Promise<Result<Settings>>;
  /** 只写不读,按服务商分别保存。传空字符串表示清除。 */
  setApiKey(input: {
    provider: ProviderId;
    key: string;
  }): Promise<Result<void>>;
  /** 各服务商是否已保存 Key,不返回 Key 本身。 */
  getKeyStatus(): Promise<Record<ProviderId, boolean>>;
  /** 用已保存的 Key 和所选模型发一次极小的真实请求,验证 Key、地址、模型是否一起可用。 */
  testApiKey(input: {
    provider: ProviderId;
    model: string;
  }): Promise<Result<void>>;

  /** 选择文件或读取剪贴板,主进程落盘后只返回句柄和预览。取消时 value 为 null。 */
  pickImage(): Promise<Result<ImageHandle | null>>;
  pasteImage(): Promise<Result<ImageHandle | null>>;
  discardImage(input: { imageId: string }): Promise<void>;

  /** hint 是家长的补充说明(如“请识别红框内的题目”),可选,长度上限见 HINT_MAX_LENGTH。 */
  analyzeMistake(input: {
    imageId: string;
    hint?: string;
  }): Promise<Result<AnalyzeResponse>>;
  getMistake(input: { mistakeId: string }): Promise<Result<MistakeDetail>>;
  confirmMistake(input: ConfirmMistakeInput): Promise<Result<void>>;
  skipAttribution(input: EditableFields): Promise<Result<void>>;
  discardDraft(input: { mistakeId: string }): Promise<Result<void>>;
  listMistakes(input?: { status?: MistakeStatus }): Promise<MistakeSummary[]>;
  getTaxonomy(): Promise<Taxonomy>;
};
