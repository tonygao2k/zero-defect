import type Database from 'better-sqlite3';
import type { HomeStats } from '../shared/stats';
import type { Term } from './papers';

/**
 * 掌握度规则(设计文档 2.4,数字为暂定值,集中在这里方便调整):
 * 按“知识点 + 错误根因”这一对判定。
 * - 错题在错题库确认、练习中答错或没做,都是“答错”事件,连续答对次数清零。
 * - 连续答对 MASTER_STREAK 次,且分布在至少 MASTER_DAYS 个不同的日子,才算已掌握。
 * - 已掌握的,满 REVIEW_AFTER_DAYS 天后复习出 1 道;复习答对后不再出,答错回到未掌握。
 */
export const MASTER_STREAK = 3;
export const MASTER_DAYS = 2;
export const REVIEW_AFTER_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type PairEvent = { correct: boolean; at: string };

export type PairState = {
  mastered: boolean;
  /** 当前连续答对次数。 */
  streak: number;
  /** 已掌握且满 7 天、还没复习过,该出一道复习题。 */
  reviewDue: boolean;
};

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/** 纯函数:按时间顺序处理一对的所有事件,得出当前状态。 */
export function evaluatePair(events: PairEvent[], now: Date): PairState {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  let streak = 0;
  let days = new Set<string>();
  let masteredAt: string | null = null;
  let attemptsSinceMastered = 0;

  for (const e of sorted) {
    if (!e.correct) {
      streak = 0;
      days = new Set();
      masteredAt = null;
      attemptsSinceMastered = 0;
      continue;
    }
    streak++;
    days.add(dayKey(e.at));
    if (masteredAt) attemptsSinceMastered++;
    else if (streak >= MASTER_STREAK && days.size >= MASTER_DAYS) {
      masteredAt = e.at;
      attemptsSinceMastered = 0;
    }
  }

  const mastered = masteredAt !== null;
  const reviewDue =
    mastered &&
    attemptsSinceMastered === 0 &&
    now.getTime() - new Date(masteredAt!).getTime() >=
      REVIEW_AFTER_DAYS * DAY_MS;
  return { mastered, streak, reviewDue };
}

export type PairKey = {
  rootCauseId: string;
  knowledgePointId: string;
};

export type PairInfo = PairKey & { state: PairState };

/** 当前学期:同年级,学期相同或旧数据没有学期。 */
const TERM_SQL = 'm.grade = ? AND (m.semester IS NULL OR m.semester = ?)';

export class MasteryRepo {
  constructor(private readonly db: Database.Database) {}

  /** 当前学期里所有已确认错题涉及的“知识点 + 根因”对及其状态。 */
  pairs(term: Term, now: Date = new Date()): PairInfo[] {
    const pairs = this.db
      .prepare(
        `SELECT DISTINCT mrc.root_cause_id AS rootCauseId, m.knowledge_point_id AS knowledgePointId
         FROM mistakes m JOIN mistake_root_causes mrc ON mrc.mistake_id = m.id AND mrc.is_primary = 1
         WHERE m.status = 'active' AND m.knowledge_point_id IS NOT NULL AND ${TERM_SQL}`,
      )
      .all(term.grade, term.semester) as PairKey[];

    const mistakeEvents = this.db.prepare(
      `SELECT m.updated_at AS at FROM mistakes m
       JOIN mistake_root_causes mrc ON mrc.mistake_id = m.id AND mrc.is_primary = 1
       WHERE m.status = 'active' AND mrc.root_cause_id = ? AND m.knowledge_point_id = ?`,
    );
    const attemptEvents = this.db.prepare(
      `SELECT is_correct AS correct, created_at AS at FROM answer_attempts
       WHERE root_cause_id = ? AND knowledge_point_id = ?`,
    );

    return pairs.map((p) => {
      const events: PairEvent[] = [
        ...(
          mistakeEvents.all(p.rootCauseId, p.knowledgePointId) as {
            at: string;
          }[]
        ).map((r) => ({ correct: false, at: r.at })),
        ...(
          attemptEvents.all(p.rootCauseId, p.knowledgePointId) as {
            correct: number;
            at: string;
          }[]
        ).map((r) => ({ correct: r.correct === 1, at: r.at })),
      ];
      return { ...p, state: evaluatePair(events, now) };
    });
  }

  homeStats(term: Term, now: Date = new Date()): HomeStats {
    const pairs = this.pairs(term, now);
    const byKp = new Map<string, boolean>();
    for (const p of pairs)
      byKp.set(
        p.knowledgePointId,
        (byKp.get(p.knowledgePointId) ?? true) && p.state.mastered,
      );
    const mastered = [...byKp.values()].filter(Boolean).length;
    const mistakeCount = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM mistakes m WHERE m.status = 'active' AND ${TERM_SQL}`,
        )
        .get(term.grade, term.semester) as { n: number }
    ).n;
    const answered = (
      this.db
        .prepare('SELECT COUNT(*) AS n FROM answer_attempts WHERE skipped = 0')
        .get() as { n: number }
    ).n;
    return {
      mistakeCount,
      knowledgePointCount: byKp.size,
      answeredCount: answered,
      masteredKnowledgePoints: mastered,
      remainingKnowledgePoints: byKp.size - mastered,
      practiceablePairs: pairs.filter(
        (p) => !p.state.mastered || p.state.reviewDue,
      ).length,
    };
  }
}
