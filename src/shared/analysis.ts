import { z } from 'zod';

/** 一份试卷(最多 6 页)最多处理的错题数,防止成本失控。 */
export const MAX_QUESTIONS_PER_ANALYSIS = 30;

/**
 * 模型返回的原始结构(设计文档 8.2)。字段尽量宽松:
 * 模型常把数字写成字符串、把缺失字段写成 null,这里先收下,再由后处理统一规整。
 */
export const RawAnalysisSchema = z.object({
  /** 这道题在照片上的编号或位置,如“第3题”。 */
  label: z.string().nullish(),
  question_markdown: z.string().default(''),
  student_answer: z.string().nullish(),
  student_work_markdown: z.string().nullish(),
  correct_answer: z.string().nullish(),
  knowledge_point_code: z.string().nullish(),
  has_student_work: z.boolean().default(false),
  /** 这道题出现在第几页(从 1 开始);跨页的题列出所有页。 */
  pages: z.array(z.coerce.number()).nullish(),
  /** 题干或解题过程在页边被截断,需要补传相邻的页。 */
  incomplete: z.boolean().nullish(),
  image_quality: z.string().nullish(),
  root_causes: z
    .array(
      z.object({
        code: z.string(),
        confidence: z.coerce.number().default(0),
        evidence: z.string().nullish(),
      }),
    )
    .default([]),
  recommended_root_cause: z.string().nullish(),
});

export type RawAnalysis = z.infer<typeof RawAnalysisSchema>;

export type BatchAnalysis = { imageQuality: string; questions: RawAnalysis[] };

/**
 * 解析模型返回的 JSON。标准格式是 { image_quality, questions: [...] };
 * 也兼容只返回单题的格式。无法解析返回 null(调用方会重试);questions 为空数组表示"没找到符合的题"。
 */
export function parseBatchAnalysis(value: unknown): BatchAnalysis | null {
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;
  const imageQuality =
    typeof obj.image_quality === 'string' ? obj.image_quality : '';
  const items = Array.isArray(obj.questions)
    ? obj.questions
    : 'question_markdown' in obj
      ? [obj]
      : null;
  if (!items) return null;

  const questions: RawAnalysis[] = [];
  for (const item of items) {
    const parsed = RawAnalysisSchema.safeParse(item);
    if (!parsed.success) continue;
    questions.push({
      ...parsed.data,
      image_quality: parsed.data.image_quality ?? imageQuality,
    });
  }
  if (items.length > 0 && questions.length === 0) return null;
  return { imageQuality, questions };
}

export type RootCauseCandidate = {
  code: string;
  confidence: number;
  evidence: string;
  /** true 表示模型给的 code 不在清单内,已映射为 needs_review。 */
  unknownFromModel: boolean;
};

/** 经过校验和后处理、可以展示给家长确认的分析结果。 */
export type AnalysisResult = {
  /** 题目在照片上的编号或位置,如“第3题”,可能为空。 */
  label: string;
  questionMarkdown: string;
  studentAnswer: string;
  studentWorkMarkdown: string;
  correctAnswer: string;
  knowledgePointCode: string;
  hasStudentWork: boolean;
  /** 所在页的序号(从 0 开始),已去重排序;空数组表示模型没有说明,调用方按“所有页”处理。 */
  pages: number[];
  /** 题目被页边截断,需要家长补传缺页。 */
  incomplete: boolean;
  /** 按置信度从高到低。 */
  rootCauses: RootCauseCandidate[];
  /** 推荐的主归因;没有可用候选时为 null,需要家长自己选。 */
  recommendedRootCause: string | null;
  /** 给家长看的中文提示。 */
  warnings: string[];
};
