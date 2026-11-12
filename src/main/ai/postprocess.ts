import type {
  AnalysisResult,
  RawAnalysis,
  RootCauseCandidate,
} from '../../shared/analysis';

export class UnreadableImageError extends Error {
  constructor() {
    super('这张图片看不清题目,请重新拍一张(光线充足、对准题目)');
    this.name = 'UnreadableImageError';
  }
}

export type PostprocessContext = {
  /** 这份试卷的页数,用来过滤模型给出的无效页码。 */
  pageCount: number;
  /** 可用于练习调度的归因 code(active = 1)。needs_review 不在其中。 */
  activeCauseCodes: ReadonlySet<string>;
  /** 当前教材、年级下可选的知识点 code,不含 other。 */
  knowledgePointCodes: ReadonlySet<string>;
  /** 低于该置信度时提示家长仔细核对,默认 0.7。 */
  confidenceThreshold: number;
};

/** 没有解题过程时归因置信度的上限(设计文档 8.3)。 */
export const NO_WORK_CONFIDENCE_CAP = 0.5;
export const NEEDS_REVIEW = 'needs_review';
export const NOT_ATTEMPTED = 'not_attempted';
export const OTHER_KNOWLEDGE_POINT = 'other';

const clamp01 = (n: number) =>
  Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
const text = (s: string | null | undefined) => (s ?? '').trim();

export function postprocess(
  raw: RawAnalysis,
  ctx: PostprocessContext,
): AnalysisResult {
  const question = text(raw.question_markdown);
  const quality = text(raw.image_quality).toLowerCase();
  if (!question || quality === 'unreadable') throw new UnreadableImageError();

  const warnings: string[] = [];
  if (quality === 'blurry')
    warnings.push('图片有些模糊,请仔细核对识别出的文字');

  // 答案和过程都是空的:孩子没有做这道题,归因固定为“未作答”,不需要模型猜。
  const unanswered =
    !text(raw.student_answer) &&
    !text(raw.student_work_markdown) &&
    ctx.activeCauseCodes.has(NOT_ATTEMPTED);
  if (unanswered) {
    warnings.push('孩子没有作答,请确认是不会做还是漏做了');
  }

  const hasWork = raw.has_student_work;
  if (!hasWork && !unanswered) warnings.push('缺少解题过程,归因仅供参考');
  const incomplete = raw.incomplete === true;
  if (incomplete)
    warnings.push('这道题被页边截断了,请补传缺的那一页,或核对题目内容');

  // 归因候选:未知 code 映射为 needs_review,同一 code 保留置信度最高的一条。
  const byCode = new Map<string, RootCauseCandidate>();
  for (const item of raw.root_causes) {
    const code = item.code.trim();
    const known = ctx.activeCauseCodes.has(code);
    const finalCode = known ? code : NEEDS_REVIEW;
    let confidence = clamp01(item.confidence);
    if (!hasWork) confidence = Math.min(confidence, NO_WORK_CONFIDENCE_CAP);
    const candidate: RootCauseCandidate = {
      code: finalCode,
      confidence,
      evidence: text(item.evidence),
      unknownFromModel: !known,
    };
    const existing = byCode.get(finalCode);
    if (!existing || candidate.confidence > existing.confidence)
      byCode.set(finalCode, candidate);
  }
  if (unanswered) {
    byCode.set(NOT_ATTEMPTED, {
      code: NOT_ATTEMPTED,
      confidence: 1,
      evidence: '卷面上没有孩子的作答',
      unknownFromModel: false,
    });
  }
  const rootCauses = [...byCode.values()].sort(
    (a, b) => b.confidence - a.confidence,
  );

  if (rootCauses.some((c) => c.unknownFromModel)) {
    warnings.push('模型给出了不在清单内的归因,请从列表中重新选择');
  }

  // 推荐主归因:优先采用模型推荐且在清单内的;否则取置信度最高的可用候选。
  const recommended = text(raw.recommended_root_cause);
  const usable = rootCauses.filter((c) => ctx.activeCauseCodes.has(c.code));
  let recommendedRootCause: string | null = null;
  if (unanswered) recommendedRootCause = NOT_ATTEMPTED;
  else if (recommended && usable.some((c) => c.code === recommended))
    recommendedRootCause = recommended;
  else if (usable.length > 0) recommendedRootCause = usable[0].code;

  if (recommendedRootCause === null) {
    warnings.push('没有找到可靠的归因,请家长手动选择');
  } else {
    const top = usable.find((c) => c.code === recommendedRootCause);
    if (top && top.confidence < ctx.confidenceThreshold) {
      warnings.push('归因把握不高,请家长仔细核对');
    }
  }

  // 知识点:不在清单内一律归入 other,由家长在确认页选择。
  const kp = text(raw.knowledge_point_code);
  let knowledgePointCode = OTHER_KNOWLEDGE_POINT;
  if (kp && ctx.knowledgePointCodes.has(kp)) knowledgePointCode = kp;
  else warnings.push('没能确定知识点,请家长选择');

  return {
    label: text(raw.label),
    questionMarkdown: question,
    studentAnswer: text(raw.student_answer),
    studentWorkMarkdown: text(raw.student_work_markdown),
    correctAnswer: text(raw.correct_answer),
    knowledgePointCode,
    hasStudentWork: hasWork,
    pages: [
      ...new Set(
        (raw.pages ?? [])
          .map((n) => Math.trunc(n) - 1)
          .filter((i) => i >= 0 && i < ctx.pageCount),
      ),
    ].sort((a, b) => a - b),
    incomplete,
    rootCauses,
    recommendedRootCause,
    warnings,
  };
}
