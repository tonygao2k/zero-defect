import crypto from 'node:crypto';
import { BAILIAN, RECOGNITION_MODEL, TEXT_MODEL } from '../../shared/bailian';
import {
  PRACTICE_SIZE,
  parsePracticeBatch,
  type PracticeAnswerInput,
  type PracticeQuestion,
  type PracticeQuestionDraft,
  type PracticeResult,
  type PracticeSession,
  type ReviseResult,
} from '../../shared/practice';
import type { Settings } from '../../shared/settings';
import { MasteryRepo, type PairInfo } from '../mastery';
import type { MistakeRepo } from '../mistakes';
import { checkPracticeAnswer } from './answers';
import { extractJson } from './json';
import { LlmError, chat as defaultChat } from './llm-client';
import { AnalysisError } from './paper-service';
import { buildGenerateMessages, buildSolveMessages } from './practice-prompt';

export type PracticeDeps = {
  repo: MistakeRepo;
  getApiKey: () => string | null;
  getSettings: () => Settings;
  chatFn?: typeof defaultChat;
  now?: () => Date;
};

type Row = {
  id: string;
  position: number;
  question_markdown: string;
  answer_type: 'choice' | 'number';
  options_json: string | null;
  correct_answer: string;
  answer_unit: string | null;
  solution_markdown: string | null;
  root_cause_id: string;
  knowledge_point_id: string;
  status: string;
};

const nowIso = (d: Date) => d.toISOString();

export class PracticeService {
  private readonly mastery: MasteryRepo;
  private starting: Promise<PracticeSession> | null = null;

  constructor(private readonly deps: PracticeDeps) {
    this.mastery = new MasteryRepo(deps.repo.db);
  }

  private get db() {
    return this.deps.repo.db;
  }
  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /**
   * 开始练习。上次没做完的练习直接接着做(不重复出题、不重复花钱);
   * 上次已经提交过的练习视为结束。出题要等一会儿,重复点击只会得到同一次结果。
   */
  start(): Promise<PracticeSession> {
    this.starting ??= this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(): Promise<PracticeSession> {
    this.db
      .prepare(
        "UPDATE practice_sessions SET status = 'completed', completed_at = ? WHERE status = 'submitted'",
      )
      .run(nowIso(this.now()));

    const pending = this.db
      .prepare(
        "SELECT id FROM practice_sessions WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1",
      )
      .get() as { id: string } | undefined;
    if (pending) return this.sessionOf(pending.id);

    const apiKey = this.deps.getApiKey();
    if (!apiKey) {
      throw new AnalysisError(
        `还没有设置${BAILIAN.shortName}的 API Key,请先到设置里填写`,
      );
    }
    const settings = this.deps.getSettings();
    const term = { grade: settings.grade, semester: settings.semester };
    const candidates = this.pickPairs(this.mastery.pairs(term, this.now()));
    if (candidates.length === 0) {
      throw new AnalysisError(
        '现在没有需要练习的内容。先去错题库确认错题,或者等已掌握的知识点到了复习时间再来',
      );
    }

    const allocation = this.allocate(candidates);
    const generated = await Promise.all(
      allocation.map((a) =>
        this.makeQuestions(a.pair, a.count, apiKey, settings),
      ),
    );
    const errors = generated.flatMap((g) => g.errors);
    const questions = this.interleave(generated.map((g) => g.questions));
    if (questions.length === 0) {
      throw new AnalysisError(errors[0] ?? '没能生成合格的练习题,请稍后重试');
    }
    return this.save(questions.slice(0, PRACTICE_SIZE));
  }

  /** 未掌握的优先(连对少的在前),再加上该复习的。 */
  private pickPairs(pairs: PairInfo[]): PairInfo[] {
    const unmastered = pairs
      .filter((p) => !p.state.mastered)
      .sort((a, b) => a.state.streak - b.state.streak);
    const review = pairs.filter((p) => p.state.mastered && p.state.reviewDue);
    return [...unmastered, ...review];
  }

  /** 把题数轮流分给各个“知识点 + 根因”,最多涉及 PRACTICE_SIZE 对。 */
  private allocate(candidates: PairInfo[]) {
    const chosen = candidates.slice(0, PRACTICE_SIZE);
    const counts = chosen.map(() => 0);
    for (let i = 0; i < PRACTICE_SIZE; i++) counts[i % chosen.length]++;
    // 多要一点,校验会淘汰一部分;最后只取 PRACTICE_SIZE 道。
    return chosen.map((pair, i) => ({ pair, count: counts[i] + 1 }));
  }

  private interleave<T>(groups: T[][]): T[] {
    const out: T[] = [];
    for (let i = 0; groups.some((g) => i < g.length); i++)
      for (const g of groups) if (i < g.length) out.push(g[i]);
    return out;
  }

  private async makeQuestions(
    pair: PairInfo,
    count: number,
    apiKey: string,
    settings: Settings,
  ): Promise<{
    questions: (PracticeQuestionDraft & { pair: PairInfo; solver: string })[];
    errors: string[];
  }> {
    const chat = this.deps.chatFn ?? defaultChat;
    const opts = {
      baseUrl: BAILIAN.baseUrl,
      providerLabel: BAILIAN.shortName,
      apiKey,
    };
    const info = this.db
      .prepare(
        `SELECT kp.label AS kp, rc.label AS cause, COALESCE(rc.description, '') AS description
         FROM knowledge_points kp, root_causes rc WHERE kp.id = ? AND rc.id = ?`,
      )
      .get(pair.knowledgePointId, pair.rootCauseId) as
      | { kp: string; cause: string; description: string }
      | undefined;
    if (!info) return { questions: [], errors: [] };

    const examples = this.db
      .prepare(
        `SELECT m.question_markdown AS question, COALESCE(m.student_answer, '') AS studentAnswer
         FROM mistakes m JOIN mistake_root_causes mrc ON mrc.mistake_id = m.id AND mrc.is_primary = 1
         WHERE m.status = 'active' AND mrc.root_cause_id = ? AND m.knowledge_point_id = ?
         ORDER BY m.updated_at DESC LIMIT 2`,
      )
      .all(pair.rootCauseId, pair.knowledgePointId) as {
      question: string;
      studentAnswer: string;
    }[];
    const avoid = (
      this.db
        .prepare(
          `SELECT question_markdown AS q FROM practice_questions
           WHERE root_cause_id = ? AND knowledge_point_id = ? ORDER BY created_at DESC LIMIT 10`,
        )
        .all(pair.rootCauseId, pair.knowledgePointId) as { q: string }[]
    ).map((r) => r.q);

    const errors: string[] = [];
    let drafts: PracticeQuestionDraft[] = [];
    try {
      // 返回的 JSON 无法解析时重试一次。
      for (let i = 0; i < 2 && drafts.length === 0; i++) {
        const text = await chat({
          ...opts,
          model: TEXT_MODEL,
          messages: buildGenerateMessages({
            grade: settings.grade,
            knowledgePoint: info.kp,
            rootCause: { label: info.cause, description: info.description },
            examples,
            avoid,
            count,
          }),
        });
        drafts = parsePracticeBatch(extractJson(text));
      }
    } catch (error) {
      errors.push(
        error instanceof LlmError ? error.message : '出题时出现未知错误',
      );
      return { questions: [], errors };
    }

    // 每道题由另一次独立求解来校验,答案不一致的丢弃。
    const verified: (PracticeQuestionDraft & {
      pair: PairInfo;
      solver: string;
    })[] = [];
    await Promise.all(
      drafts.map(async (d) => {
        try {
          const text = await chat({
            ...opts,
            model: RECOGNITION_MODEL,
            messages: buildSolveMessages(d),
          });
          const solved = (extractJson(text) as { answer?: unknown } | null)
            ?.answer;
          const answer =
            typeof solved === 'string' || typeof solved === 'number'
              ? String(solved)
              : '';
          if (
            checkPracticeAnswer(d.answerType, answer, d.correctAnswer, d.unit)
          )
            verified.push({ ...d, pair, solver: answer });
        } catch (error) {
          errors.push(
            error instanceof LlmError ? error.message : '校验答案时出错',
          );
        }
      }),
    );
    // Promise.all 里的完成顺序不固定,按出题顺序还原。
    verified.sort((a, b) => drafts.indexOf(a) - drafts.indexOf(b));
    return { questions: verified, errors };
  }

  private save(
    questions: (PracticeQuestionDraft & { pair: PairInfo; solver: string })[],
  ): PracticeSession {
    const sessionId = crypto.randomUUID();
    const t = nowIso(this.now());
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO practice_sessions (id, practice_date, status, created_at) VALUES (?, ?, 'pending', ?)",
        )
        .run(sessionId, t.slice(0, 10), t);
      const insert = this.db.prepare(
        `INSERT INTO practice_questions (id, session_id, position, root_cause_id, knowledge_point_id, source_mistake_id,
           question_markdown, answer_type, options_json, correct_answer, answer_unit, solution_markdown, difficulty, status, verify_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'assigned', ?, ?)`,
      );
      questions.forEach((q, i) => {
        const source = this.db
          .prepare(
            `SELECT m.id FROM mistakes m JOIN mistake_root_causes mrc ON mrc.mistake_id = m.id AND mrc.is_primary = 1
             WHERE m.status = 'active' AND mrc.root_cause_id = ? AND m.knowledge_point_id = ?
             ORDER BY m.updated_at DESC LIMIT 1`,
          )
          .get(q.pair.rootCauseId, q.pair.knowledgePointId) as
          | { id: string }
          | undefined;
        insert.run(
          crypto.randomUUID(),
          sessionId,
          i,
          q.pair.rootCauseId,
          q.pair.knowledgePointId,
          source?.id ?? null,
          q.questionMarkdown,
          q.answerType,
          q.answerType === 'choice' ? JSON.stringify(q.options) : null,
          q.correctAnswer,
          q.unit || null,
          q.solutionMarkdown || null,
          JSON.stringify({ solver: q.solver, model: RECOGNITION_MODEL }),
          t,
        );
      });
    })();
    this.deps.repo.logRun({
      type: 'generate_practice',
      input: { sessionId, count: questions.length },
      output: null,
      model: TEXT_MODEL,
      status: 'ok',
    });
    return this.sessionOf(sessionId);
  }

  private rows(sessionId: string): Row[] {
    return this.db
      .prepare(
        'SELECT * FROM practice_questions WHERE session_id = ? ORDER BY position',
      )
      .all(sessionId) as Row[];
  }

  private sessionOf(sessionId: string): PracticeSession {
    return {
      sessionId,
      questions: this.rows(sessionId).map(
        (r): PracticeQuestion => ({
          id: r.id,
          position: r.position,
          questionMarkdown: r.question_markdown,
          answerType: r.answer_type,
          options: r.options_json
            ? (JSON.parse(r.options_json) as string[])
            : [],
          unit: r.answer_unit ?? '',
        }),
      ),
    };
  }

  /**
   * 提交一次练习:每道题记录对错(没作答记为答错并标记“跳过”),
   * 之后掌握度据此推算。此时不公布答案。
   */
  submit(input: {
    sessionId: string;
    answers: PracticeAnswerInput[];
    elapsedMs?: number;
  }): PracticeResult {
    const session = this.db
      .prepare('SELECT status FROM practice_sessions WHERE id = ?')
      .get(input.sessionId) as { status: string } | undefined;
    if (!session) throw new AnalysisError('找不到这次练习');
    if (session.status !== 'pending')
      throw new AnalysisError('这次练习已经提交过了');

    const given = new Map(input.answers.map((a) => [a.questionId, a.answer]));
    const t = nowIso(this.now());
    const wrongQuestionIds: string[] = [];
    let correctCount = 0;
    const perQuestion =
      input.elapsedMs && input.elapsedMs > 0
        ? Math.round(
            input.elapsedMs / Math.max(this.rows(input.sessionId).length, 1),
          )
        : null;

    this.db.transaction(() => {
      const insert = this.db.prepare(
        `INSERT INTO answer_attempts (id, practice_question_id, root_cause_id, knowledge_point_id, submitted_answer,
           normalized_answer, is_correct, skipped, answer_time_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const q of this.rows(input.sessionId)) {
        const submitted = (given.get(q.id) ?? '').trim();
        const skipped = submitted === '';
        const correct =
          !skipped &&
          checkPracticeAnswer(
            q.answer_type,
            submitted,
            q.correct_answer,
            q.answer_unit ?? '',
          );
        if (correct) correctCount++;
        else wrongQuestionIds.push(q.id);
        insert.run(
          crypto.randomUUID(),
          q.id,
          q.root_cause_id,
          q.knowledge_point_id,
          submitted,
          submitted.toLowerCase(),
          correct ? 1 : 0,
          skipped ? 1 : 0,
          perQuestion,
          t,
        );
        this.db
          .prepare(
            "UPDATE practice_questions SET status = 'answered' WHERE id = ?",
          )
          .run(q.id);
      }
      this.db
        .prepare(
          "UPDATE practice_sessions SET status = 'submitted' WHERE id = ?",
        )
        .run(input.sessionId);
    })();
    return {
      correctCount,
      wrongCount: wrongQuestionIds.length,
      wrongQuestionIds,
    };
  }

  /**
   * 订正一道本次答错的题。答对或放弃(giveUp)时才公布答案和解析。
   * 只允许订正这次练习里答错的题,避免借此探测别的题的答案。
   */
  revise(input: {
    questionId: string;
    answer: string;
    giveUp?: boolean;
  }): ReviseResult {
    const q = this.db
      .prepare(
        `SELECT pq.*, ps.status AS session_status,
                (SELECT is_correct FROM answer_attempts a WHERE a.practice_question_id = pq.id ORDER BY a.created_at, a.rowid LIMIT 1) AS first_correct
         FROM practice_questions pq JOIN practice_sessions ps ON ps.id = pq.session_id WHERE pq.id = ?`,
      )
      .get(input.questionId) as
      | (Row & { session_status: string; first_correct: number | null })
      | undefined;
    if (!q || q.session_status !== 'submitted' || q.first_correct !== 0) {
      throw new AnalysisError('这道题现在不能订正');
    }
    const correct =
      !input.giveUp &&
      checkPracticeAnswer(
        q.answer_type,
        input.answer,
        q.correct_answer,
        q.answer_unit ?? '',
      );
    const reveal = correct || input.giveUp === true;
    return {
      correct,
      correctAnswer: reveal ? q.correct_answer : null,
      solutionMarkdown: reveal ? (q.solution_markdown ?? '') : null,
    };
  }

  /** 结束练习。没订正的题已经在提交时记为答错,会影响之后的出题。 */
  finish(sessionId: string): void {
    this.db
      .prepare(
        "UPDATE practice_sessions SET status = 'completed', completed_at = ? WHERE id = ? AND status IN ('submitted','pending')",
      )
      .run(nowIso(this.now()), sessionId);
  }
}
