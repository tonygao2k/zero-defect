import { z } from 'zod';

/** 一次智能练习的题数(设计文档:3~5 道)。 */
export const PRACTICE_SIZE = 5;

/**
 * 第一期只有两种题型(设计文档 2.3):
 * - choice:选择题,答案是选项字母。
 * - number:计算题和应用题,孩子只输入最终结果,不写过程。
 */
export type AnswerType = 'choice' | 'number';

/** 模型生成的一道题。字段宽松,再由 parsePracticeBatch 规整。 */
export const RawPracticeQuestionSchema = z.object({
  question_markdown: z.string().default(''),
  answer_type: z.string().default(''),
  options: z.array(z.string()).nullish(),
  correct_answer: z.coerce.string().default(''),
  unit: z.string().nullish(),
  solution_markdown: z.string().nullish(),
});

export type PracticeQuestionDraft = {
  questionMarkdown: string;
  answerType: AnswerType;
  /** 选择题的选项文字(不含字母),顺序对应 A、B、C、D。 */
  options: string[];
  correctAnswer: string;
  unit: string;
  solutionMarkdown: string;
};

const LETTERS = ['A', 'B', 'C', 'D'];

/** 规整模型给出的题:题型不对、选项不是 4 个、选择题答案不是字母的都丢弃。 */
export function parsePracticeBatch(value: unknown): PracticeQuestionDraft[] {
  const items =
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { questions?: unknown }).questions)
      ? (value as { questions: unknown[] }).questions
      : [];
  const out: PracticeQuestionDraft[] = [];
  for (const item of items) {
    const parsed = RawPracticeQuestionSchema.safeParse(item);
    if (!parsed.success) continue;
    const q = parsed.data;
    const question = q.question_markdown.trim();
    const correct = q.correct_answer.trim();
    if (!question || !correct) continue;
    if (q.answer_type === 'choice') {
      const options = (q.options ?? []).map((o) =>
        o.replace(/^\s*[A-Da-d][.、:：)）]\s*/, '').trim(),
      );
      const letter = correct.toUpperCase().slice(0, 1);
      if (options.length !== 4 || options.some((o) => !o)) continue;
      if (!LETTERS.includes(letter)) continue;
      out.push({
        questionMarkdown: question,
        answerType: 'choice',
        options,
        correctAnswer: letter,
        unit: '',
        solutionMarkdown: (q.solution_markdown ?? '').trim(),
      });
    } else if (q.answer_type === 'number') {
      out.push({
        questionMarkdown: question,
        answerType: 'number',
        options: [],
        correctAnswer: correct,
        unit: (q.unit ?? '').trim(),
        solutionMarkdown: (q.solution_markdown ?? '').trim(),
      });
    }
  }
  return out;
}

/** 界面拿到的题:不含正确答案。 */
export type PracticeQuestion = {
  id: string;
  position: number;
  questionMarkdown: string;
  answerType: AnswerType;
  options: string[];
  unit: string;
};

export type PracticeSession = {
  sessionId: string;
  questions: PracticeQuestion[];
};

/**
 * 第一次提交就记录对错(没学会的会留在后台,影响之后的出题)。
 * 此时不公布答案:孩子可以选择“修改错题”重做,或直接结束练习。
 */
export type PracticeResult = {
  correctCount: number;
  wrongCount: number;
  /** 本次答错或没做的题,“修改错题”只重做这些。 */
  wrongQuestionIds: string[];
};

export type PracticeAnswerInput = {
  questionId: string;
  /** 选择题是字母,计算题是孩子输入的结果;没作答传空字符串。 */
  answer: string;
};

/**
 * 订正:答对或放弃时才公布正确答案和解析。
 * 订正不再计入掌握度:孩子已经知道自己错了,不能算作掌握的证据。
 */
export type ReviseResult = {
  correct: boolean;
  correctAnswer: string | null;
  solutionMarkdown: string | null;
};
