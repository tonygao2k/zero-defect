import crypto from 'node:crypto';
import {
  HINT_MAX_LENGTH,
  MAX_QUESTIONS_PER_ANALYSIS,
  parseBatchAnalysis,
  type AnalysisResult,
  type BatchAnalysis,
} from '../../shared/analysis';
import { PROVIDERS, type ProviderId } from '../../shared/providers';
import type { Settings } from '../../shared/settings';
import type { ImageStore } from '../images';
import type { MistakeRepo } from '../mistakes';
import { isAnsweredCorrectly } from './answers';
import { extractJson } from './json';
import { LlmError, chat as defaultChat } from './llm-client';
import { postprocess, UnreadableImageError } from './postprocess';
import { buildAnalysisMessages } from './prompt';

/** 带有可直接展示给家长的中文消息。 */
export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisError';
  }
}

export type AnalyzedMistake = { mistakeId: string; analysis: AnalysisResult };

export type AnalyzeOutcome =
  /**
   * skipped:确实做错、但没能处理的题数(结果不完整,或超过单次上限)。
   * ignoredCorrect:模型列出但核对后发现孩子答对了的题数,已忽略。
   */
  | {
      kind: 'ok';
      mistakes: AnalyzedMistake[];
      skipped: number;
      ignoredCorrect: number;
    }
  /** 同图同说明已经分析过。pendingIds 是其中还没确认的草稿。 */
  | { kind: 'duplicate'; mistakeIds: string[]; pendingIds: string[] };

export type AnalysisDeps = {
  repo: MistakeRepo;
  images: ImageStore;
  getApiKey: (provider: ProviderId) => string | null;
  getSettings: () => Settings;
  chatFn?: typeof defaultChat;
};

/** 模型返回的 JSON 解析失败时自动重试一次(设计文档 8.3)。 */
const PARSE_ATTEMPTS = 2;

export class AnalysisService {
  constructor(private readonly deps: AnalysisDeps) {}

  async analyze(imageId: string, rawHint?: string): Promise<AnalyzeOutcome> {
    const { repo, images } = this.deps;
    const settings = this.deps.getSettings();
    const provider = PROVIDERS[settings.provider];
    const apiKey = this.deps.getApiKey(settings.provider);
    if (!apiKey) {
      throw new AnalysisError(
        `还没有设置${provider.shortName}的 API Key,请先到家长入口填写`,
      );
    }

    const hint = (rawHint ?? '').trim();
    if (hint.length > HINT_MAX_LENGTH) {
      throw new AnalysisError(
        `补充说明太长了,请控制在 ${HINT_MAX_LENGTH} 字以内`,
      );
    }

    // 一张照片(如整张卷子)可以按不同说明分析多次,每次可能得到多道题。
    // 去重键 = 图片哈希 + 说明:同图同说明才算重复;没有说明时就是图片哈希本身。
    const imageHash = images.hashOf(imageId);
    const analysisKey = hint
      ? crypto
          .createHash('sha256')
          .update(`${imageHash}\n${hint}`)
          .digest('hex')
      : imageHash;
    const existing = repo.findByAnalysisKey(analysisKey);
    if (existing.length > 0) {
      images.discard(imageId);
      return {
        kind: 'duplicate',
        mistakeIds: existing.map((e) => e.id),
        pendingIds: existing
          .filter((e) => e.status === 'draft')
          .map((e) => e.id),
      };
    }

    const causes = repo.listActiveCauses();
    const points = repo.knowledgePointsFor(
      settings.curriculumId,
      settings.grade,
    );
    const messages = buildAnalysisMessages({
      grade: settings.grade,
      causes,
      knowledgePoints: points,
      imageDataUrl: `data:image/jpeg;base64,${images.read(imageId).toString('base64')}`,
      hint,
    });

    // ai_runs 不保存图片内容,只保存哈希和参数。
    const runInput = {
      provider: settings.provider,
      imageHash,
      hint: hint || undefined,
      grade: settings.grade,
      curriculumId: settings.curriculumId,
    };
    const log = (
      status: 'ok' | 'failed',
      output: string | null,
      error?: string,
    ) =>
      repo.logRun({
        type: 'analyze_mistake',
        input: runInput,
        output,
        model: settings.model,
        status,
        error,
      });
    const fail = (message: string, output: string | null): never => {
      log('failed', output, message);
      throw new AnalysisError(message);
    };

    const chat = this.deps.chatFn ?? defaultChat;
    let batch: BatchAnalysis | null = null;
    let lastText = '';
    try {
      for (let i = 0; i < PARSE_ATTEMPTS && !batch; i++) {
        lastText = await chat({
          baseUrl: provider.baseUrl,
          providerLabel: provider.shortName,
          apiKey,
          model: settings.model,
          messages,
        });
        batch = parseBatchAnalysis(extractJson(lastText));
      }
    } catch (error) {
      fail(
        error instanceof LlmError ? error.message : '分析时出现未知错误,请重试',
        null,
      );
    }
    if (!batch) {
      return fail(
        'AI 返回的内容无法解析,请重试;如果多次失败,可以手动录入',
        lastText,
      );
    }

    if (batch.questions.length === 0) {
      return fail(
        batch.imageQuality === 'unreadable'
          ? new UnreadableImageError().message
          : '没有找到符合的题目。可以在补充说明里写得更具体(例如“第 3 题”),或换一张更清晰的照片',
        lastText,
      );
    }

    // 模型有时会把没做错的题也列出来(尤其是整张卷子都要识别时)。
    // 孩子的答案和模型算出的正确答案一致的,不是错题。必须在限制数量之前剔除,
    // 否则卷子前面做对的题会把后面真正的错题挤出去。
    const wrong = batch.questions.filter(
      (q) => !isAnsweredCorrectly(q.student_answer, q.correct_answer),
    );
    const ignoredCorrect = batch.questions.length - wrong.length;
    if (wrong.length === 0) {
      return fail(
        `AI 核对了 ${batch.questions.length} 道题,没有发现做错的。如果确定有错,请在补充说明里指出是哪一题`,
        lastText,
      );
    }

    // 逐题后处理:个别题结果不完整不影响其他题。
    const ctx = {
      activeCauseCodes: new Set(causes.map((c) => c.code)),
      knowledgePointCodes: new Set(points.map((p) => p.code)),
      confidenceThreshold: settings.confidenceThreshold,
    };
    const analyses: AnalysisResult[] = [];
    let firstError = '';
    for (const q of wrong.slice(0, MAX_QUESTIONS_PER_ANALYSIS)) {
      try {
        analyses.push(postprocess(q, ctx));
      } catch (error) {
        firstError ||=
          error instanceof UnreadableImageError
            ? error.message
            : '分析结果不完整,请重试';
      }
    }
    if (analyses.length === 0) return fail(firstError, lastText);
    const skipped = wrong.length - analyses.length;

    // 分析成功才把图片移入正式目录并写入草稿;同一次分析的多道题共用这一份图片。
    // 写库失败(整体回滚)要把图片退回清理掉。
    const imagePath = images.promote(imageId, analysisKey);
    try {
      const ids = repo.createDrafts(
        analyses.map((analysis) => ({
          imagePath,
          imageHash,
          analysisKey,
          analysis,
          grade: settings.grade,
          curriculumId: settings.curriculumId,
        })),
      );
      log('ok', lastText);
      return {
        kind: 'ok',
        mistakes: ids.map((mistakeId, i) => ({
          mistakeId,
          analysis: analyses[i],
        })),
        skipped,
        ignoredCorrect,
      };
    } catch (error) {
      images.removeStored(imagePath);
      throw error;
    }
  }
}
