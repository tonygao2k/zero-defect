import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRACTICE_SIZE } from '../../shared/practice';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { openDatabase } from '../db/open';
import { MasteryRepo } from '../mastery';
import { MistakeRepo } from '../mistakes';
import { PaperRepo } from '../papers';
import { LlmError } from './llm-client';
import { PracticeService } from './practice-service';

const term = { grade: 3, semester: 1 };

const choiceQ = (n: number, answer = 'B') => ({
  question_markdown: `选择题 ${n}`,
  answer_type: 'choice',
  options: ['甲', '乙', '丙', '丁'],
  correct_answer: answer,
  solution_markdown: '思路',
});
const numberQ = (n: number, answer = '12') => ({
  question_markdown: `计算题 ${n}`,
  answer_type: 'number',
  correct_answer: answer,
  unit: '个',
  solution_markdown: '思路',
});
const generated = (qs: unknown[]) => JSON.stringify({ questions: qs });

/** 出题请求返回 qs;求解请求按题目文字查表返回答案(默认与标准答案一致)。 */
function fakeChat(
  qs: ReturnType<typeof choiceQ | typeof numberQ>[],
  solver: (q: {
    question_markdown: string;
    correct_answer: string;
  }) => string = (q) => q.correct_answer,
) {
  return vi.fn(
    async (opts: { model: string; messages: { content: unknown }[] }) => {
      const user = String(opts.messages[1].content);
      if (user.includes('请出')) return generated(qs);
      const q = qs.find((x) => user.includes(x.question_markdown));
      if (!q) throw new Error('unexpected');
      return JSON.stringify({ answer: solver(q) });
    },
  );
}

let repo: MistakeRepo;
let paperId: string;
let clock = new Date(2026, 10, 12, 10);

const addMistake = (kp = 'mul_two_digit', cause = 'carry_omission') => {
  const id = repo.createDraft({
    paperId,
    pageIds: [],
    analysis: {
      label: '',
      questionMarkdown: '计算 23×14',
      studentAnswer: '312',
      studentWorkMarkdown: '',
      correctAnswer: '322',
      knowledgePointCode: kp,
      hasStudentWork: false,
      pages: [],
      incomplete: false,
      rootCauses: [],
      recommendedRootCause: null,
      warnings: [],
    },
    grade: 3,
    semester: 1,
    curriculumId: 'pep_primary_math',
  });
  repo.confirm({
    mistakeId: id,
    questionMarkdown: '计算 23×14',
    studentAnswer: '312',
    studentWorkMarkdown: '',
    correctAnswer: '322',
    knowledgePointCode: kp,
    rootCauseCode: cause,
  });
  // 错题确认时间固定在练习之前,避免依赖真实的当前时间。
  repo.db
    .prepare('UPDATE mistakes SET updated_at = ?')
    .run(new Date(2026, 10, 1).toISOString());
};

const service = (
  chatFn: ReturnType<typeof vi.fn>,
  apiKey: string | null = 'sk-test',
) =>
  new PracticeService({
    repo,
    getApiKey: () => apiKey,
    getSettings: () => DEFAULT_SETTINGS,
    chatFn: chatFn as never,
    now: () => clock,
  });

const five = () => [
  choiceQ(1),
  numberQ(2),
  choiceQ(3),
  numberQ(4),
  choiceQ(5),
  numberQ(6),
];

beforeEach(() => {
  clock = new Date(2026, 10, 12, 10);
  const db = openDatabase(':memory:');
  repo = new MistakeRepo(db);
  paperId = new PaperRepo(db).create({
    title: 'p',
    analysisKey: 'k',
    grade: 3,
    semester: 1,
    curriculumId: 'pep_primary_math',
    pages: [{ imagePath: '/a.jpg', imageHash: 'h' }],
  });
});

describe('PracticeService.start', () => {
  it('generates questions for a weak pair, verified by an independent solve, without answers', async () => {
    addMistake();
    const chatFn = fakeChat(five());
    const session = await service(chatFn).start();

    expect(session.questions).toHaveLength(PRACTICE_SIZE);
    for (const q of session.questions) {
      expect(q).not.toHaveProperty('correctAnswer');
      expect(q.questionMarkdown).toBeTruthy();
    }
    const choice = session.questions.find((q) => q.answerType === 'choice');
    expect(choice?.options).toHaveLength(4);
    // 求解请求不能带上原来的答案。
    const solveCalls = chatFn.mock.calls.filter(
      ([o]) => !String(o.messages[1].content).includes('请出'),
    );
    expect(solveCalls.length).toBeGreaterThan(0);
    for (const [o] of solveCalls)
      expect(JSON.stringify(o.messages)).not.toContain('correct_answer');
  });

  it('saves a figure, returns it, and describes it to the independent solve', async () => {
    addMistake();
    const bars = {
      type: 'bar_chart',
      unit: '人',
      bars: [
        { label: '一班', value: 30 },
        { label: '二班', value: 25 },
      ],
    };
    const qs = five().map((q, i) => (i === 1 ? { ...q, figure: bars } : q));
    const chatFn = fakeChat(qs as never);
    const session = await service(chatFn).start();
    const withFigure = session.questions.filter((q) => q.figure);
    expect(withFigure).toHaveLength(1);
    expect(withFigure[0].figure).toMatchObject({ type: 'bar_chart' });
    expect(session.questions.filter((q) => !q.figure)).toHaveLength(4);
    // 求解请求里带有配图的文字描述,但没有答案。
    const solveText = chatFn.mock.calls
      .map(([o]) => String(o.messages[1].content))
      .filter((t) => t.includes('条形统计图'));
    expect(solveText.length).toBeGreaterThan(0);
    expect(solveText[0]).toContain('一班:30');
  });

  it('drops questions whose independent solve disagrees', async () => {
    addMistake();
    const qs = five();
    const chatFn = fakeChat(qs, (q) =>
      q.question_markdown === '计算题 2' ? '99' : q.correct_answer,
    );
    const session = await service(chatFn).start();
    const texts = session.questions.map((q) => q.questionMarkdown);
    expect(texts).not.toContain('计算题 2');
    expect(texts).toHaveLength(5);
  });

  it('fails clearly when every question is rejected, and saves nothing', async () => {
    addMistake();
    const chatFn = fakeChat(five(), () => 'wrong');
    await expect(service(chatFn).start()).rejects.toThrow(/没能生成合格/);
    expect(
      repo.db.prepare('SELECT COUNT(*) AS n FROM practice_sessions').get(),
    ).toEqual({ n: 0 });
  });

  it('surfaces a provider error', async () => {
    addMistake();
    const chatFn = vi.fn().mockRejectedValue(new LlmError('auth', 'Key 不对'));
    await expect(service(chatFn).start()).rejects.toThrow(/Key 不对/);
  });

  it('refuses without an API key, and when there is nothing to practise', async () => {
    const chatFn = fakeChat(five());
    await expect(service(chatFn).start()).rejects.toThrow(/没有需要练习/);
    addMistake();
    await expect(service(chatFn, null).start()).rejects.toThrow(/API Key/);
    expect(chatFn).not.toHaveBeenCalled();
  });

  it('resumes an unfinished session instead of generating again', async () => {
    addMistake();
    const chatFn = fakeChat(five());
    const svc = service(chatFn);
    const first = await svc.start();
    const calls = chatFn.mock.calls.length;
    const again = await svc.start();
    expect(again.sessionId).toBe(first.sessionId);
    expect(chatFn.mock.calls.length).toBe(calls);
  });

  it('two quick clicks share one generation', async () => {
    addMistake();
    const chatFn = fakeChat(five());
    const svc = service(chatFn);
    const [a, b] = await Promise.all([svc.start(), svc.start()]);
    expect(a.sessionId).toBe(b.sessionId);
    expect(
      repo.db.prepare('SELECT COUNT(*) AS n FROM practice_sessions').get(),
    ).toEqual({ n: 1 });
  });

  it('spreads questions over several weak pairs', async () => {
    addMistake('mul_two_digit', 'carry_omission');
    addMistake('perimeter', 'unit_omission');
    const chatFn = fakeChat(five());
    const session = await service(chatFn).start();
    expect(session.questions).toHaveLength(PRACTICE_SIZE);
    const pairs = new Set(
      (
        repo.db
          .prepare(
            'SELECT root_cause_id AS c, knowledge_point_id AS k FROM practice_questions',
          )
          .all() as { c: string; k: string }[]
      ).map((r) => `${r.c}/${r.k}`),
    );
    expect(pairs.size).toBe(2);
  });
});

describe('submit / revise / finish', () => {
  const started = async () => {
    addMistake();
    const svc = service(fakeChat(five()));
    const session = await svc.start();
    const correctOf = (id: string) =>
      (
        repo.db
          .prepare(
            'SELECT correct_answer AS a FROM practice_questions WHERE id = ?',
          )
          .get(id) as { a: string }
      ).a;
    return { svc, session, correctOf };
  };

  it('scores answers, counts blanks as wrong, and records every attempt', async () => {
    const { svc, session, correctOf } = await started();
    const [q1, q2, q3, ...rest] = session.questions;
    const result = svc.submit({
      sessionId: session.sessionId,
      answers: [
        { questionId: q1.id, answer: correctOf(q1.id) },
        { questionId: q2.id, answer: '0' }, // 错
        // q3 没作答
        ...rest.map((q) => ({ questionId: q.id, answer: correctOf(q.id) })),
      ],
    });
    expect(result.correctCount).toBe(3);
    expect(result.wrongCount).toBe(2);
    expect(new Set(result.wrongQuestionIds)).toEqual(new Set([q2.id, q3.id]));

    const attempts = repo.db
      .prepare(
        'SELECT practice_question_id AS q, is_correct AS c, skipped AS s FROM answer_attempts',
      )
      .all() as { q: string; c: number; s: number }[];
    expect(attempts).toHaveLength(5);
    expect(attempts.find((a) => a.q === q3.id)).toMatchObject({ c: 0, s: 1 });
    expect(attempts.find((a) => a.q === q2.id)).toMatchObject({ c: 0, s: 0 });
  });

  it('cannot be submitted twice', async () => {
    const { svc, session } = await started();
    svc.submit({ sessionId: session.sessionId, answers: [] });
    expect(() =>
      svc.submit({ sessionId: session.sessionId, answers: [] }),
    ).toThrow(/已经提交/);
  });

  it('reveals the answer only after a correct revision or giving up', async () => {
    const { svc, session, correctOf } = await started();
    const [q1] = session.questions;
    svc.submit({ sessionId: session.sessionId, answers: [] });

    const wrong = svc.revise({ questionId: q1.id, answer: 'zzz' });
    expect(wrong).toEqual({
      correct: false,
      correctAnswer: null,
      solutionMarkdown: null,
    });

    const right = svc.revise({ questionId: q1.id, answer: correctOf(q1.id) });
    expect(right.correct).toBe(true);
    expect(right.correctAnswer).toBe(correctOf(q1.id));

    const gave = svc.revise({ questionId: q1.id, answer: '', giveUp: true });
    expect(gave).toMatchObject({
      correct: false,
      correctAnswer: correctOf(q1.id),
    });
  });

  it('cannot revise a question that was answered correctly, or before submitting', async () => {
    const { svc, session, correctOf } = await started();
    const [q1, q2] = session.questions;
    expect(() => svc.revise({ questionId: q1.id, answer: 'x' })).toThrow(
      /不能订正/,
    );
    svc.submit({
      sessionId: session.sessionId,
      answers: [{ questionId: q1.id, answer: correctOf(q1.id) }],
    });
    expect(() =>
      svc.revise({ questionId: q1.id, answer: 'x', giveUp: true }),
    ).toThrow(/不能订正/);
    expect(svc.revise({ questionId: q2.id, answer: 'x' }).correct).toBe(false);
  });

  it('revising does not create attempts, so it cannot count towards mastery', async () => {
    const { svc, session, correctOf } = await started();
    const [q1] = session.questions;
    svc.submit({ sessionId: session.sessionId, answers: [] });
    svc.revise({ questionId: q1.id, answer: correctOf(q1.id) });
    expect(
      repo.db.prepare('SELECT COUNT(*) AS n FROM answer_attempts').get(),
    ).toEqual({ n: 5 });
  });

  it('leaving unrevised mistakes keeps the pair unmastered, and the next practice starts fresh', async () => {
    const { svc, session } = await started();
    svc.submit({ sessionId: session.sessionId, answers: [] });
    svc.finish(session.sessionId);
    const [pair] = new MasteryRepo(repo.db).pairs(term, clock);
    expect(pair.state).toMatchObject({ mastered: false, streak: 0 });

    const next = await svc.start();
    expect(next.sessionId).not.toBe(session.sessionId);
  });

  it('masters a pair only after three correct practices on two different days', async () => {
    addMistake();
    const svc = service(fakeChat(five()));
    const answerAll = async (day: number) => {
      clock = new Date(2026, 10, day, 10);
      const session = await svc.start();
      const answers = session.questions.map((q) => ({
        questionId: q.id,
        answer: (
          repo.db
            .prepare(
              'SELECT correct_answer AS a FROM practice_questions WHERE id = ?',
            )
            .get(q.id) as { a: string }
        ).a,
      }));
      svc.submit({ sessionId: session.sessionId, answers });
      svc.finish(session.sessionId);
    };
    const mastered = () =>
      new MasteryRepo(repo.db).pairs(term, clock)[0].state.mastered;

    // 一次练习里每道题都是这一对的一次作答:5 次连对。
    await answerAll(13);
    expect(mastered()).toBe(false); // 全在同一天
    await answerAll(14);
    expect(mastered()).toBe(true); // 跨了两天
  });
});

describe('PracticeService: figures on the original mistakes', () => {
  const addFigureMistake = (kind: string, note: string) => {
    addMistake();
    repo.db
      .prepare('UPDATE mistakes SET analysis_json = ?')
      .run(JSON.stringify({ figureKind: kind, figureNote: note }));
  };

  const generateUser = (chatFn: ReturnType<typeof fakeChat>) =>
    String(
      chatFn.mock.calls.find(([o]) =>
        String(o.messages[1].content).includes('请出'),
      )![0].messages[1].content,
    );

  it('tells the generator what kind of figure the original had', async () => {
    addFigureMistake('cube_net', '6 个带字的格子,问哪两个字相对');
    const chatFn = fakeChat(five());
    await service(chatFn).start();
    const user = generateUser(chatFn);
    expect(user).toContain('正方体展开图');
    expect(user).toContain('6 个带字的格子,问哪两个字相对');
    expect(user).toContain('新题也要配同类的图');
  });

  it('asks for a text-only variant when the original figure cannot be drawn', async () => {
    addFigureMistake('other', '两条线段首尾相接的线段图');
    const chatFn = fakeChat(five());
    await service(chatFn).start();
    const user = generateUser(chatFn);
    expect(user).toContain('画不了');
    expect(user).not.toContain('新题也要配同类的图');
  });

  it('adds no figure hint for ordinary or legacy mistakes', async () => {
    addMistake(); // 旧数据:analysis_json 里没有配图项
    const chatFn = fakeChat(five());
    await service(chatFn).start();
    expect(generateUser(chatFn)).not.toContain('原题配有');
  });
});

describe('PracticeService: code-verified figures are not re-solved by the model', () => {
  it('keeps a cube-net question without asking the solver, and hints figures for old mistakes', async () => {
    addMistake();
    repo.db
      .prepare(
        "UPDATE mistakes SET question_markdown = '右面是正方体盒子的展开图,与“聚”相对的字是?'",
      )
      .run();
    const net = {
      question_markdown: '折成正方体后,与“左”相对的字是?',
      answer_type: 'choice',
      options: ['上', '右', '前', '后'],
      correct_answer: 'B',
      solution_markdown: '思路',
      opposite_of: '左',
      figure: {
        type: 'cube_net',
        cells: [
          { row: 0, col: 1, text: '上' },
          { row: 1, col: 0, text: '左' },
          { row: 1, col: 1, text: '前' },
          { row: 1, col: 2, text: '右' },
          { row: 1, col: 3, text: '后' },
          { row: 2, col: 1, text: '下' },
        ],
      },
    };
    const chatFn = fakeChat([net as never, ...five().slice(0, 5)]);
    const session = await service(chatFn).start();
    expect(session.questions.some((q) => q.figure?.type === 'cube_net')).toBe(
      true,
    );
    const solvedTexts = chatFn.mock.calls
      .map(([o]) => String(o.messages[1].content))
      .filter((t) => !t.includes('请出'));
    expect(solvedTexts.some((t) => t.includes('相对的字是'))).toBe(false);
    const generateUser = String(
      chatFn.mock.calls.find(([o]) =>
        String(o.messages[1].content).includes('请出'),
      )![0].messages[1].content,
    );
    expect(generateUser).toContain('原题配有正方体展开图');
  });
});
