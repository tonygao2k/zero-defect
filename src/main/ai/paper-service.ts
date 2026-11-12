import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  MAX_QUESTIONS_PER_ANALYSIS,
  parseBatchAnalysis,
  type AnalysisResult,
  type BatchAnalysis,
} from '../../shared/analysis';
import { BAILIAN, RECOGNITION_MODEL } from '../../shared/bailian';
import { MAX_PAGES_PER_PAPER, normalizePaperTitle } from '../../shared/papers';
import type { Settings } from '../../shared/settings';
import type { ImageStore } from '../images';
import type { MistakeRepo } from '../mistakes';
import type { PaperRepo } from '../papers';
import { isAnsweredCorrectly } from './answers';
import { extractJson } from './json';
import { LlmError, chat as defaultChat, type LlmUsage } from './llm-client';
import { postprocess, UnreadableImageError } from './postprocess';
import { buildAnalysisMessages } from './prompt';

/** 带有可直接展示给家长的中文消息。 */
export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisError';
  }
}

export type SubmitOutcome =
  | { kind: 'started'; paperId: string }
  /** 同样的图片按同样的顺序已经识别过。 */
  | { kind: 'duplicate'; paperId: string; title: string };

export type PaperDeps = {
  papers: PaperRepo;
  repo: MistakeRepo;
  images: ImageStore;
  getApiKey: () => string | null;
  getSettings: () => Settings;
  chatFn?: typeof defaultChat;
};

/** 模型返回的 JSON 解析失败时自动重试一次(设计文档 8.3)。 */
const PARSE_ATTEMPTS = 2;
/** 6 页试卷的输出可能很长;qwen3-vl-plus 的输出上限是 32768。 */
const RECOGNITION_MAX_TOKENS = 16384;

const sha256 = (text: string) =>
  crypto.createHash('sha256').update(text).digest('hex');

export class PaperService {
  private readonly running = new Set<Promise<void>>();

  constructor(private readonly deps: PaperDeps) {}

  /** 启动时调用:上次退出时还没识别完的试卷标记为失败,家长可以重试。 */
  recoverInterrupted(): void {
    this.deps.papers.recoverInterrupted();
  }

  /** 等待所有后台识别结束。测试用,界面靠轮询状态。 */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled(this.running);
  }

  /**
   * 提交一份试卷:检查、去重、把图片存入正式目录并建好记录,然后在后台识别,立刻返回。
   * 图片按页序给出。同样的图片按同样顺序再次提交算重复;上次失败的可以直接重新提交。
   */
  submit(input: { imageIds: string[]; title: string }): SubmitOutcome {
    const { papers, images } = this.deps;
    const ids = input.imageIds;
    if (ids.length === 0) throw new AnalysisError('请先添加试卷图片');
    if (ids.length > MAX_PAGES_PER_PAPER) {
      throw new AnalysisError(
        `一份试卷最多 ${MAX_PAGES_PER_PAPER} 页,请分次提交`,
      );
    }
    if (!this.deps.getApiKey()) {
      throw new AnalysisError(
        `还没有设置${BAILIAN.shortName}的 API Key,请先到设置里填写`,
      );
    }

    const hashes = ids.map((id) => images.hashOf(id));
    const analysisKey = sha256(hashes.join('\n'));
    const existing = papers.findByKey(analysisKey);
    if (existing && existing.status !== 'failed') {
      for (const id of ids) images.discard(id);
      return {
        kind: 'duplicate',
        paperId: existing.id,
        title: existing.title,
      };
    }
    // 上次失败的同一份试卷:删掉旧记录和图片,重新来过。
    if (existing) {
      for (const p of papers.delete(existing.id)) images.removeStored(p);
    }

    const settings = this.deps.getSettings();
    const stored: string[] = [];
    try {
      const pages = ids.map((id, i) => {
        const imagePath = images.promote(id, sha256(`${analysisKey}:${i}`));
        stored.push(imagePath);
        return { imagePath, imageHash: hashes[i] };
      });
      const paperId = papers.create({
        title: normalizePaperTitle(input.title),
        analysisKey,
        grade: settings.grade,
        semester: settings.semester,
        curriculumId: settings.curriculumId,
        pages,
      });
      this.start(paperId);
      return { kind: 'started', paperId };
    } catch (error) {
      for (const p of stored) images.removeStored(p);
      throw error;
    }
  }

  /** 重试失败的试卷:图片已经在本地,不需要重新选择。 */
  retry(paperId: string): void {
    const paper = this.deps.papers.get(paperId);
    if (paper.status !== 'failed') {
      throw new AnalysisError('这份试卷不需要重试');
    }
    if (!this.deps.getApiKey()) {
      throw new AnalysisError(
        `还没有设置${BAILIAN.shortName}的 API Key,请先到设置里填写`,
      );
    }
    this.deps.papers.setStatus(paperId, 'processing');
    this.start(paperId);
  }

  /** 删除整份试卷:错题、页和图片文件一起清理。 */
  deletePaper(paperId: string): void {
    for (const p of this.deps.papers.delete(paperId))
      this.deps.images.removeStored(p);
  }

  private start(paperId: string): void {
    const task = this.run(paperId)
      .catch((error: unknown) => {
        // run 自己处理已知错误;走到这里说明是意料之外的,也要让试卷离开“识别中”。
        console.error('[paper] unexpected error:', error);
        this.deps.papers.setStatus(paperId, 'failed', {
          errorMessage: '识别时出现未知错误,请重试',
        });
      })
      .finally(() => this.running.delete(task));
    this.running.add(task);
  }

  private async run(paperId: string): Promise<void> {
    const { papers, repo } = this.deps;
    const paper = papers.get(paperId);
    const pages = papers.pages(paperId);
    const settings = this.deps.getSettings();
    const apiKey = this.deps.getApiKey();
    if (!apiKey) {
      papers.setStatus(paperId, 'failed', {
        errorMessage: `还没有设置${BAILIAN.shortName}的 API Key,请先到设置里填写`,
      });
      return;
    }

    const causes = repo.listActiveCauses();
    const points = repo.knowledgePointsFor(
      paper.curriculumId ?? settings.curriculumId,
      paper.grade ?? settings.grade,
    );
    const messages = buildAnalysisMessages({
      grade: paper.grade ?? settings.grade,
      causes,
      knowledgePoints: points,
      imageDataUrls: pages.map(
        (p) =>
          `data:image/jpeg;base64,${fs.readFileSync(p.imagePath).toString('base64')}`,
      ),
    });

    // ai_runs 不保存图片内容,只保存哈希、页数和用量。
    const usage: LlmUsage = { promptTokens: 0, completionTokens: 0 };
    const log = (
      status: 'ok' | 'failed',
      output: string | null,
      error?: string,
    ) =>
      repo.logRun({
        type: 'analyze_paper',
        input: {
          paperId,
          pageHashes: pages.map((p) => p.imageHash),
          grade: paper.grade,
          usage,
        },
        output,
        model: RECOGNITION_MODEL,
        status,
        error,
      });
    const fail = (message: string, output: string | null): void => {
      log('failed', output, message);
      papers.setStatus(paperId, 'failed', { errorMessage: message });
    };

    const chat = this.deps.chatFn ?? defaultChat;
    let batch: BatchAnalysis | null = null;
    let lastText = '';
    try {
      for (let i = 0; i < PARSE_ATTEMPTS && !batch; i++) {
        lastText = await chat({
          baseUrl: BAILIAN.baseUrl,
          providerLabel: BAILIAN.shortName,
          apiKey,
          model: RECOGNITION_MODEL,
          messages,
          maxTokens: RECOGNITION_MAX_TOKENS,
          timeoutMs: 300_000,
          onUsage: (u) => {
            usage.promptTokens += u.promptTokens;
            usage.completionTokens += u.completionTokens;
          },
        });
        batch = parseBatchAnalysis(extractJson(lastText));
      }
    } catch (error) {
      return fail(
        error instanceof LlmError ? error.message : '分析时出现未知错误,请重试',
        null,
      );
    }
    if (!batch) {
      return fail(
        'AI 返回的内容无法解析,请点重试;如果多次失败,可以换一份更清晰的图片',
        lastText,
      );
    }
    if (batch.questions.length === 0 && batch.imageQuality === 'unreadable') {
      return fail(new UnreadableImageError().message, lastText);
    }

    // 模型有时会把没做错的题也列出来。孩子的答案和模型算出的正确答案一致的,不是错题。
    // 必须在限制数量之前剔除,否则卷子前面做对的题会把后面真正的错题挤出去。
    const wrong = batch.questions.filter(
      (q) => !isAnsweredCorrectly(q.student_answer, q.correct_answer),
    );
    const ctx = {
      pageCount: pages.length,
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
    if (wrong.length > 0 && analyses.length === 0)
      return fail(firstError, lastText);
    const skipped = wrong.length - analyses.length;

    try {
      repo.createDrafts(
        analyses.map((analysis) => ({
          paperId,
          // 模型没说清在哪一页时,这道题关联到所有页。
          pageIds: (analysis.pages.length > 0
            ? analysis.pages.map((i) => pages[i])
            : pages
          ).map((p) => p.id),
          analysis,
          grade: paper.grade ?? settings.grade,
          semester: paper.semester ?? settings.semester,
          curriculumId: paper.curriculumId ?? settings.curriculumId,
        })),
      );
    } catch (error) {
      console.error('[paper] save failed:', error);
      return fail('保存识别结果失败,请重试', lastText);
    }
    log('ok', lastText);
    papers.setStatus(paperId, 'done', { skippedCount: skipped });
  }
}
