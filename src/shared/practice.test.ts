import { describe, expect, it } from 'vitest';
import { parsePracticeBatch } from './practice';

// 1-4-1 展开图:左右相对、前后相对、上下相对。
const cross = {
  type: 'cube_net',
  cells: [
    { row: 0, col: 1, text: '上' },
    { row: 1, col: 0, text: '左' },
    { row: 1, col: 1, text: '前' },
    { row: 1, col: 2, text: '右' },
    { row: 1, col: 3, text: '后' },
    { row: 2, col: 1, text: '下' },
  ],
};

const netQuestion = (answer: string, extra: object = {}) => ({
  question_markdown: '折成正方体后,与“左”相对的字是?',
  answer_type: 'choice',
  options: ['上', '右', '前', '后'],
  correct_answer: answer,
  figure: cross,
  opposite_of: '左',
  ...extra,
});

const stackQuestion = (extra: object = {}) => ({
  question_markdown:
    '用小正方体搭成下图的立体图形,从前面看,能看到几个小正方形?',
  answer_type: 'number',
  unit: '个',
  correct_answer: '5',
  figure: {
    type: 'cube_stack',
    heights: [
      [1, 1, 1],
      [3, 0, 0],
    ],
  },
  view_of: 'front',
  ...extra,
});

describe('parsePracticeBatch with cube stacks', () => {
  it('keeps a stack question whose answer matches the computed view', () => {
    const [q] = parsePracticeBatch({ questions: [stackQuestion()] });
    expect(q.figure?.type).toBe('cube_stack');
  });

  it('drops one whose answer is wrong for that view, or has no valid view', () => {
    expect(
      parsePracticeBatch({ questions: [stackQuestion({ view_of: 'left' })] }),
    ).toEqual([]);
    expect(
      parsePracticeBatch({
        questions: [stackQuestion({ correct_answer: '4' })],
      }),
    ).toEqual([]);
    expect(
      parsePracticeBatch({ questions: [stackQuestion({ view_of: null })] }),
    ).toEqual([]);
  });

  it('checks the chosen option for a multiple-choice stack question', () => {
    const choice = (answer: string) =>
      stackQuestion({
        answer_type: 'choice',
        options: ['3个', '4个', '5个', '6个'],
        correct_answer: answer,
      });
    expect(parsePracticeBatch({ questions: [choice('C')] })).toHaveLength(1);
    expect(parsePracticeBatch({ questions: [choice('B')] })).toEqual([]);
  });

  it('drops a "view from" question that has no figure', () => {
    expect(
      parsePracticeBatch({
        questions: [
          {
            question_markdown: '5 个小正方体搭成立体图形,从左面看能看到几个?',
            answer_type: 'number',
            correct_answer: '4',
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe('parsePracticeBatch with figures', () => {
  it('keeps a cube-net question whose answer is the true opposite face', () => {
    const [q] = parsePracticeBatch({ questions: [netQuestion('B')] });
    expect(q.figure?.type).toBe('cube_net');
    expect(q.correctAnswer).toBe('B');
  });

  it('drops a cube-net question whose answer is not the opposite face', () => {
    expect(parsePracticeBatch({ questions: [netQuestion('A')] })).toEqual([]);
  });

  it('drops a cube-net question that cannot fold, or asks about a missing face', () => {
    const line = {
      type: 'cube_net',
      cells: [0, 1, 2, 3, 4, 5].map((c) => ({ row: 0, col: c, text: `${c}` })),
    };
    expect(
      parsePracticeBatch({ questions: [netQuestion('B', { figure: line })] }),
    ).toEqual([]);
    expect(
      parsePracticeBatch({
        questions: [netQuestion('B', { opposite_of: '中' })],
      }),
    ).toEqual([]);
  });

  it('keeps questions without a figure, and drops ones with a broken figure', () => {
    const plain = {
      question_markdown: '计算 3+4',
      answer_type: 'number',
      correct_answer: '7',
    };
    const [q] = parsePracticeBatch({ questions: [plain] });
    expect(q.figure).toBeNull();
    expect(
      parsePracticeBatch({
        questions: [{ ...plain, figure: { type: 'pie' } }],
      }),
    ).toEqual([]);
  });

  it('drops questions that say "see the figure" but have none', () => {
    const q = (text: string) => ({
      question_markdown: text,
      answer_type: 'number',
      correct_answer: '7',
    });
    for (const text of [
      '下图是一个正方体的展开图,与“学”相对的字是?',
      '如图,点 A 表示几?',
      '看统计图,一班有多少人?',
    ]) {
      expect(parsePracticeBatch({ questions: [q(text)] })).toEqual([]);
    }
    expect(parsePracticeBatch({ questions: [q('计算 3+4')] })).toHaveLength(1);
  });

  it('keeps a "see the figure" question when the figure is attached', () => {
    const [q] = parsePracticeBatch({
      questions: [
        {
          question_markdown: '看统计图,一班有多少人?',
          answer_type: 'number',
          correct_answer: '30',
          figure: {
            type: 'bar_chart',
            unit: '人',
            bars: [
              { label: '一班', value: 30 },
              { label: '二班', value: 25 },
            ],
          },
        },
      ],
    });
    expect(q.figure?.type).toBe('bar_chart');
  });

  it('drops true/false questions and ones that ask for a written expression', () => {
    const q = (text: string) => ({
      question_markdown: text,
      answer_type: 'number',
      correct_answer: '10',
    });
    for (const text of [
      '判断对错:1.5 吨就是 1500 克。( )',
      '买 6 本笔记本,每本多少元?请列出综合算式并计算结果。',
      '请写出算式,再求结果。',
    ]) {
      expect(parsePracticeBatch({ questions: [q(text)] })).toEqual([]);
    }
  });

  it('accepts a number line question', () => {
    const [q] = parsePracticeBatch({
      questions: [
        {
          question_markdown: '点 A 表示几?',
          answer_type: 'number',
          correct_answer: '3.5',
          figure: {
            type: 'number_line',
            min: 0,
            max: 10,
            step: 1,
            marks: [{ value: 3.5, label: 'A' }],
          },
        },
      ],
    });
    expect(q.figure?.type).toBe('number_line');
  });
});

describe('parsePracticeBatch: figure rules that real output exposed', () => {
  const plain = (text: string) => ({
    question_markdown: text,
    answer_type: 'number',
    correct_answer: '4',
  });

  it('drops a "view from" question even when the wording is bold or inside a formula', () => {
    expect(
      parsePracticeBatch({
        questions: [
          plain('搭好后,从**正面**看这个立体图形,能看到几个小正方形?'),
        ],
      }),
    ).toEqual([]);
    expect(
      parsePracticeBatch({
        questions: [plain('从 $左$ 面看这个立体图形,几个?')],
      }),
    ).toEqual([]);
  });

  it('requires opposite_of for a cube net, and options taken from the figure', () => {
    const q = (extra: object) => ({
      question_markdown: '折成正方体后,与“左”相对的字是?',
      answer_type: 'choice',
      options: ['上', '右', '前', '后'],
      correct_answer: 'B',
      figure: cross,
      opposite_of: '左',
      ...extra,
    });
    expect(parsePracticeBatch({ questions: [q({})] })).toHaveLength(1);
    expect(
      parsePracticeBatch({ questions: [q({ opposite_of: null })] }),
    ).toEqual([]);
    expect(
      parsePracticeBatch({
        questions: [q({ options: ['天', '右', '前', '后'] })],
      }),
    ).toEqual([]);
    expect(
      parsePracticeBatch({
        questions: [q({ answer_type: 'number', correct_answer: '右' })],
      }),
    ).toEqual([]);
  });
});
