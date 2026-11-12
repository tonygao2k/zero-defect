import type { AnalysisResult } from './analysis';
import type {
  BatchConfirmResult,
  ConfirmMistakeInput,
  ListMistakesInput,
  MistakeStatus,
  MistakeSummary,
  EditableFields,
} from './mistakes';
import type { PaperSummary } from './papers';
import type {
  PracticeAnswerInput,
  PracticeResult,
  PracticeSession,
  ReviseResult,
} from './practice';
import type { HomeStats } from './stats';
import type { Settings } from './settings';

/** IPC 通道名,主进程和预加载脚本共用,避免两边拼写不一致。 */
export const IPC = {
  getAppVersion: 'app:getVersion',
  checkForUpdate: 'update:check',
  openReleasePage: 'update:openReleasePage',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  setApiKey: 'settings:setApiKey',
  hasApiKey: 'settings:hasApiKey',
  testApiKey: 'settings:testApiKey',
  pickFiles: 'file:pick',
  pasteImage: 'image:paste',
  importImage: 'image:import',
  discardImage: 'image:discard',
  submitPaper: 'paper:submit',
  listPapers: 'paper:list',
  renamePaper: 'paper:rename',
  deletePaper: 'paper:delete',
  retryPaper: 'paper:retry',
  confirmPaper: 'paper:confirmAll',
  getMistake: 'mistake:get',
  confirmMistake: 'mistake:confirm',
  confirmRecommended: 'mistake:confirmRecommended',
  deleteMistake: 'mistake:delete',
  listMistakes: 'mistake:list',
  getTaxonomy: 'taxonomy:get',
  getHomeStats: 'home:stats',
  startPractice: 'practice:start',
  submitPractice: 'practice:submit',
  revisePractice: 'practice:revise',
  finishPractice: 'practice:finish',
} as const;

export type UpdateCheckResult =
  | { status: 'update_available'; current: string; latest: string }
  | { status: 'up_to_date'; current: string }
  | { status: 'no_release'; current: string }
  | { status: 'error'; current: string; message: string };

/** 可能失败的调用统一返回 Result,错误消息是可直接展示给家长的中文。 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type ImageHandle = { imageId: string; previewDataUrl: string };

/** 选文件对话框的结果:图片已导入为句柄,PDF 把原始字节交给界面转成每页图片。 */
export type PickedFile =
  | { kind: 'image'; handle: ImageHandle }
  | { kind: 'pdf'; name: string; bytes: Uint8Array };

export type SubmitResponse =
  | { kind: 'started'; paperId: string }
  | { kind: 'duplicate'; paperId: string; title: string };

export type MistakeDetail = {
  id: string;
  status: MistakeStatus;
  paperId: string | null;
  paperTitle: string | null;
  incomplete: boolean;
  /** 这道题涉及的页的图片,按页序;跨页题有多张。 */
  imageDataUrls: string[];
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
  /** 只写不读。传空字符串表示清除。 */
  setApiKey(input: { key: string }): Promise<Result<void>>;
  /** 是否已保存 Key,不返回 Key 本身。 */
  hasApiKey(): Promise<boolean>;
  /** 用已保存的 Key 发一次极小的真实请求,验证 Key 是否可用。 */
  testApiKey(): Promise<Result<void>>;

  /** 选择图片或 PDF(可多选)。取消时 value 为空数组。 */
  pickFiles(): Promise<Result<PickedFile[]>>;
  pasteImage(): Promise<Result<ImageHandle | null>>;
  /** 界面把 PDF 的某一页渲染成 JPEG 后交给主进程,得到和普通图片一样的句柄。 */
  importImage(input: { bytes: Uint8Array }): Promise<Result<ImageHandle>>;
  discardImage(input: { imageId: string }): Promise<void>;

  /** 提交一份试卷:图片按页序,标签为空则用默认时间。立即返回,识别在后台进行。 */
  submitPaper(input: {
    imageIds: string[];
    title: string;
  }): Promise<Result<SubmitResponse>>;
  listPapers(input?: { allTerms?: boolean }): Promise<PaperSummary[]>;
  renamePaper(input: { paperId: string; title: string }): Promise<Result<void>>;
  deletePaper(input: { paperId: string }): Promise<Result<void>>;
  retryPaper(input: { paperId: string }): Promise<Result<void>>;
  /** 对整份试卷里所有待确认的题,采用 AI 推荐的原因批量确认。 */
  confirmPaper(input: { paperId: string }): Promise<Result<BatchConfirmResult>>;

  getMistake(input: { mistakeId: string }): Promise<Result<MistakeDetail>>;
  confirmMistake(input: ConfirmMistakeInput): Promise<Result<void>>;
  /**
   * 直接采用 AI 推荐的原因和知识点确认。confirmed 为 false 时信息不够,什么都没改,
   * 界面应打开详情页让家长补充。
   */
  confirmRecommended(input: {
    mistakeId: string;
  }): Promise<Result<{ confirmed: boolean }>>;
  deleteMistake(input: { mistakeId: string }): Promise<Result<void>>;
  listMistakes(input?: ListMistakesInput): Promise<MistakeSummary[]>;
  getTaxonomy(): Promise<Taxonomy>;

  getHomeStats(): Promise<HomeStats>;
  /** 开始(或接着做)一次智能练习。出题要等一会儿。 */
  startPractice(): Promise<Result<PracticeSession>>;
  submitPractice(input: {
    sessionId: string;
    answers: PracticeAnswerInput[];
    elapsedMs?: number;
  }): Promise<Result<PracticeResult>>;
  /** 订正本次答错的题。答对或放弃时才返回答案和解析。 */
  revisePractice(input: {
    questionId: string;
    answer: string;
    giveUp?: boolean;
  }): Promise<Result<ReviseResult>>;
  finishPractice(input: { sessionId: string }): Promise<Result<void>>;
};
