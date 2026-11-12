import { describe, expect, it } from 'vitest';
import { openDatabase } from './db/open';
import { MistakeRepo } from './mistakes';
import { MasteryRepo, evaluatePair, type PairEvent } from './mastery';
import { PaperRepo } from './papers';

// 用本地时间构造,避免时区让“同一天”判断在不同机器上不一致。
const at = (day: number, hour = 10) =>
  new Date(2026, 10, day, hour).toISOString();
const ok = (day: number, hour = 10): PairEvent => ({
  correct: true,
  at: at(day, hour),
});
const bad = (day: number, hour = 10): PairEvent => ({
  correct: false,
  at: at(day, hour),
});
const now = (day: number) => new Date(2026, 10, day, 12);

describe('evaluatePair', () => {
  it('is not mastered with only a confirmed mistake', () => {
    expect(evaluatePair([bad(1)], now(1))).toMatchObject({
      mastered: false,
      streak: 0,
    });
  });

  it('needs three correct in a row', () => {
    expect(evaluatePair([bad(1), ok(2), ok(3)], now(3)).mastered).toBe(false);
    expect(evaluatePair([bad(1), ok(2), ok(3), ok(4)], now(4)).mastered).toBe(
      true,
    );
  });

  it('three correct on the same day is not enough: they must span two days', () => {
    const sameDay = [bad(1), ok(2, 9), ok(2, 10), ok(2, 11)];
    expect(evaluatePair(sameDay, now(2)).mastered).toBe(false);
    // 第二天再答对一次就够了。
    expect(evaluatePair([...sameDay, ok(3)], now(3)).mastered).toBe(true);
  });

  it('a wrong answer resets the streak and the days', () => {
    const events = [bad(1), ok(2), ok(3), bad(4), ok(5), ok(6)];
    expect(evaluatePair(events, now(6))).toMatchObject({
      mastered: false,
      streak: 2,
    });
  });

  it('a mastered pair goes back to unmastered after a wrong answer', () => {
    const events = [bad(1), ok(2), ok(3), ok(4), bad(5)];
    expect(evaluatePair(events, now(5)).mastered).toBe(false);
  });

  it('a skipped (wrong) question counts as wrong too', () => {
    // 跳过的题记为答错,和答错同样处理。
    expect(evaluatePair([bad(1), ok(2), ok(3), bad(4)], now(4)).streak).toBe(0);
  });

  it('asks for one review 7 days after mastering, and not before', () => {
    const events = [bad(1), ok(2), ok(3), ok(4)];
    expect(evaluatePair(events, now(10)).reviewDue).toBe(false); // 6 天
    expect(evaluatePair(events, now(11)).reviewDue).toBe(true); // 7 天
  });

  it('stops asking once the review was answered correctly', () => {
    const events = [bad(1), ok(2), ok(3), ok(4), ok(12)];
    const s = evaluatePair(events, now(30));
    expect(s.mastered).toBe(true);
    expect(s.reviewDue).toBe(false);
  });

  it('a wrong review brings it back as unmastered and not due for review', () => {
    const s = evaluatePair([bad(1), ok(2), ok(3), ok(4), bad(12)], now(13));
    expect(s).toMatchObject({ mastered: false, reviewDue: false });
  });

  it('ignores the order events were given in', () => {
    const shuffled = [ok(4), bad(1), ok(3), ok(2)];
    expect(evaluatePair(shuffled, now(4)).mastered).toBe(true);
  });
});

describe('MasteryRepo', () => {
  const setup = () => {
    const db = openDatabase(':memory:');
    const repo = new MistakeRepo(db);
    const papers = new PaperRepo(db);
    const paperId = papers.create({
      title: 'p',
      analysisKey: 'k',
      grade: 3,
      semester: 1,
      curriculumId: 'pep_primary_math',
      pages: [{ imagePath: '/a.jpg', imageHash: 'h' }],
    });
    const mistake = (kp: string, cause: string) => {
      const id = repo.createDraft({
        paperId,
        pageIds: [],
        analysis: {
          label: '',
          questionMarkdown: 'q',
          studentAnswer: '1',
          studentWorkMarkdown: '',
          correctAnswer: '2',
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
        questionMarkdown: 'q',
        studentAnswer: '1',
        studentWorkMarkdown: '',
        correctAnswer: '2',
        knowledgePointCode: kp,
        rootCauseCode: cause,
      });
      return id;
    };
    return { db, repo, mastery: new MasteryRepo(db), mistake };
  };

  const attempt = (
    db: ReturnType<typeof setup>['db'],
    cause: string,
    kp: string,
    correct: boolean,
    when: string,
    skipped = 0,
  ) => {
    const qid = `q-${Math.random()}`;
    db.prepare(
      `INSERT INTO practice_questions (id, root_cause_id, knowledge_point_id, question_markdown, answer_type, correct_answer, difficulty, status, created_at)
       VALUES (?, ?, ?, 'q', 'number', '1', 1, 'answered', ?)`,
    ).run(qid, cause, kp, when);
    db.prepare(
      `INSERT INTO answer_attempts (id, practice_question_id, root_cause_id, knowledge_point_id, submitted_answer, is_correct, skipped, created_at)
       VALUES (?, ?, ?, ?, '1', ?, ?, ?)`,
    ).run(`a-${Math.random()}`, qid, cause, kp, correct ? 1 : 0, skipped, when);
  };

  it('lists a pair per confirmed mistake and starts unmastered', () => {
    const { mastery, mistake } = setup();
    mistake('mul_two_digit', 'carry_omission');
    mistake('mul_two_digit', 'carry_omission'); // 同一对只算一条
    const pairs = mastery.pairs({ grade: 3, semester: 1 });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].state.mastered).toBe(false);
  });

  it('does not count drafts or other terms', () => {
    const { mastery, repo, mistake } = setup();
    const id = mistake('mul_two_digit', 'carry_omission');
    repo.db
      .prepare("UPDATE mistakes SET status = 'draft' WHERE id = ?")
      .run(id);
    expect(mastery.pairs({ grade: 3, semester: 1 })).toHaveLength(0);
    repo.db
      .prepare(
        "UPDATE mistakes SET status = 'active', semester = 2 WHERE id = ?",
      )
      .run(id);
    expect(mastery.pairs({ grade: 3, semester: 1 })).toHaveLength(0);
    expect(mastery.pairs({ grade: 3, semester: 2 })).toHaveLength(1);
  });

  it('reports home stats: a knowledge point is mastered only when all its causes are', () => {
    const { db, mastery, mistake } = setup();
    mistake('mul_two_digit', 'carry_omission');
    mistake('mul_two_digit', 'calculation_error');
    mistake('perimeter', 'unit_omission');

    // carry_omission 连续 3 次答对且跨两天 → 这一对掌握;但同知识点还有一个根因没掌握。
    const future = new Date(2099, 0, 1).toISOString();
    attempt(db, 'carry_omission', 'mul_two_digit', true, future);
    attempt(
      db,
      'carry_omission',
      'mul_two_digit',
      true,
      new Date(2099, 0, 2).toISOString(),
    );
    attempt(
      db,
      'carry_omission',
      'mul_two_digit',
      true,
      new Date(2099, 0, 3).toISOString(),
    );

    const stats = mastery.homeStats(
      { grade: 3, semester: 1 },
      new Date(2099, 0, 3),
    );
    expect(stats).toMatchObject({
      mistakeCount: 3,
      knowledgePointCount: 2,
      answeredCount: 3,
      masteredKnowledgePoints: 0,
      remainingKnowledgePoints: 2,
    });

    attempt(db, 'calculation_error', 'mul_two_digit', true, future);
    attempt(
      db,
      'calculation_error',
      'mul_two_digit',
      true,
      new Date(2099, 0, 2).toISOString(),
    );
    attempt(
      db,
      'calculation_error',
      'mul_two_digit',
      true,
      new Date(2099, 0, 3).toISOString(),
    );
    const after = mastery.homeStats(
      { grade: 3, semester: 1 },
      new Date(2099, 0, 3),
    );
    expect(after).toMatchObject({
      masteredKnowledgePoints: 1,
      remainingKnowledgePoints: 1,
    });
  });

  it('does not count skipped questions as answered', () => {
    const { db, mastery, mistake } = setup();
    mistake('mul_two_digit', 'carry_omission');
    attempt(
      db,
      'carry_omission',
      'mul_two_digit',
      false,
      new Date(2099, 0, 1).toISOString(),
      1,
    );
    expect(mastery.homeStats({ grade: 3, semester: 1 }).answeredCount).toBe(0);
  });

  it('has zero stats for an empty library', () => {
    expect(setup().mastery.homeStats({ grade: 3, semester: 1 })).toEqual({
      mistakeCount: 0,
      knowledgePointCount: 0,
      answeredCount: 0,
      masteredKnowledgePoints: 0,
      remainingKnowledgePoints: 0,
      practiceablePairs: 0,
    });
  });

  it('counts pairs that can be practised: unmastered, or mastered and due for review', () => {
    const { db, mastery, mistake } = setup();
    mistake('mul_two_digit', 'carry_omission');
    expect(mastery.homeStats({ grade: 3, semester: 1 }).practiceablePairs).toBe(
      1,
    );
    for (const d of [1, 2, 3])
      attempt(
        db,
        'carry_omission',
        'mul_two_digit',
        true,
        new Date(2099, 0, d).toISOString(),
      );
    // 刚掌握:没有可练的。
    expect(
      mastery.homeStats({ grade: 3, semester: 1 }, new Date(2099, 0, 4))
        .practiceablePairs,
    ).toBe(0);
    // 满 7 天:该复习。
    expect(
      mastery.homeStats({ grade: 3, semester: 1 }, new Date(2099, 0, 11))
        .practiceablePairs,
    ).toBe(1);
  });
});
