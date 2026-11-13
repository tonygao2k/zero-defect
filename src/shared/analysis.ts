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
  /** 原题带的图属于哪一类;没有图就是 none。 */
  figure_kind: z.string().nullish(),
  /** 一句话说明原题配图的特点,出变式题时参考。 */
  figure_note: z.string().nullish(),
});

/**
 * 原题配图的类别。前四类是应用能画的(见 figure.ts),出变式题时可以配同类的图;
 * other 是画不了的图(几何作图、情境图等),只记下特点。
 */
export const FIGURE_KINDS = [
  'none',
  'cube_net',
  'number_line',
  'bar_chart',
  'cube_stack',
  'other',
] as const;
export type FigureKind = (typeof FIGURE_KINDS)[number];

/**
 * 旧数据没有记录配图类别,按题目文字猜一个。猜不准也没关系,
 * 只用来提示出题:能画的类别要求配同类的图,画不了的提醒改成文字题。
 */
export function inferFigureKind(question: string): FigureKind {
  const t = question.replace(/[*_$\\\s]/g, '');
  if (/展开图/.test(t)) return 'cube_net';
  if (/数轴/.test(t)) return 'number_line';
  if (/统计图|条形图/.test(t)) return 'bar_chart';
  if (
    /从[前后左右上正侧][^，。]{0,16}看.{0,8}(立体图形|正方体|小正方体)/.test(t)
  )
    return 'cube_stack';
  if (/[上下左右如见]图|看图|图中|图示/.test(t)) return 'other';
  return 'none';
}

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
  /** 原题配图的类别;旧数据没有这一项,按没有图处理。 */
  figureKind?: FigureKind;
  /** 原题配图的特点,没有就是空字符串。 */
  figureNote?: string;
};
