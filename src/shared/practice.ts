import { z } from 'zod';
import {
  oppositeFace,
  parseFigure,
  stackViewCount,
  type Figure,
} from './figure';

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
  figure: z.unknown().optional(),
  /** 展开图题:问的是哪个字的对面。代码据此核对正确答案。 */
  opposite_of: z.string().nullish(),
  /** 立体图形题:从哪个方向看(front/back/left/right/top)。代码据此算出正确的个数。 */
  view_of: z.string().nullish(),
});

export type PracticeQuestionDraft = {
  questionMarkdown: string;
  answerType: AnswerType;
  /** 选择题的选项文字(不含字母),顺序对应 A、B、C、D。 */
  options: string[];
  correctAnswer: string;
  unit: string;
  solutionMarkdown: string;
  /** 配图;没有就是 null。 */
  figure: Figure | null;
};

const LETTERS = ['A', 'B', 'C', 'D'];

/** 题目里提到“下图”“展开图”等,必须真的带了配图。 */
const REFERS_TO_FIGURE =
  /[上下左右如见]图|展开图|图中|图示|统计图|示意图|从[前后左右上正]面看|从[前后左右上]边看|俯视/;

/** 判断对错、要求列算式或写过程的题,孩子只能输入最终结果,没法作答。 */
const UNSUPPORTED_STYLE =
  /判断对错|判断下面|列出.{0,6}算式|写出.{0,6}算式|写出.{0,4}过程/;

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
    const parsedFigure = parseFigure(q.figure);
    if (!parsedFigure.ok) continue;
    const figure = parsedFigure.figure;
    // 题目说“看图”却没有图:孩子看不到图,这道题没法做。
    // 先去掉加粗、公式符号和空白再判断,否则“从**正面**看”这样的写法会漏过去。
    if (!figure && REFERS_TO_FIGURE.test(question.replace(/[*_$\\\s]/g, '')))
      continue;
    // 判断对错、要求写算式的题不在两种题型里。
    if (UNSUPPORTED_STYLE.test(question)) continue;
    // 立体图形题:要看几个小正方形,由代码按位置表算出,答案对不上就丢。
    let stackCount: number | null = null;
    if (figure?.type === 'cube_stack') {
      stackCount = stackViewCount(figure, q.view_of ?? '');
      if (stackCount === null) continue;
    }
    if (q.answer_type === 'choice') {
      const options = (q.options ?? []).map((o) =>
        o.replace(/^\s*[A-Da-d][.、:：)）]\s*/, '').trim(),
      );
      const letter = correct.toUpperCase().slice(0, 1);
      if (options.length !== 4 || options.some((o) => !o)) continue;
      if (!LETTERS.includes(letter)) continue;
      // 展开图题:必须说明问的是哪个字,选项都取自图里的字,
      // 正确选项必须正是折起来后与它相对的字。答案由代码算出,不信模型。
      if (figure?.type === 'cube_net') {
        const faces = new Set(figure.cells.map((c) => c.text));
        if (!q.opposite_of || options.some((o) => !faces.has(o))) continue;
        const expected = oppositeFace(figure, q.opposite_of);
        if (expected === null || options[LETTERS.indexOf(letter)] !== expected)
          continue;
      }
      if (
        stackCount !== null &&
        numberIn(options[LETTERS.indexOf(letter)]) !== stackCount
      )
        continue;
      out.push({
        questionMarkdown: question,
        answerType: 'choice',
        options,
        correctAnswer: letter,
        unit: '',
        solutionMarkdown: (q.solution_markdown ?? '').trim(),
        figure,
      });
    } else if (q.answer_type === 'number') {
      // 展开图题只能是选择题。
      if (figure?.type === 'cube_net') continue;
      if (stackCount !== null && numberIn(correct) !== stackCount) continue;
      out.push({
        questionMarkdown: question,
        answerType: 'number',
        options: [],
        correctAnswer: correct,
        unit: (q.unit ?? '').trim(),
        solutionMarkdown: (q.solution_markdown ?? '').trim(),
        figure,
      });
    }
  }
  return out;
}

/**
 * 答案已经由代码按图算出并核对过的配图:展开图、立体图。
 * 这两类不再交给模型求解,因为模型心算折叠、数方块容易出错,还很慢。
 */
export function isCodeVerified(figure: Figure | null): boolean {
  return figure?.type === 'cube_net' || figure?.type === 'cube_stack';
}

/** 取出文字里的整数(如“5个”→5),取不到返回 null。 */
function numberIn(text: string): number | null {
  const m = text.normalize('NFKC').match(/-?\d+/);
  return m ? Number(m[0]) : null;
}

/** 界面拿到的题:不含正确答案。 */
export type PracticeQuestion = {
  id: string;
  position: number;
  questionMarkdown: string;
  answerType: AnswerType;
  options: string[];
  unit: string;
  figure: Figure | null;
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
