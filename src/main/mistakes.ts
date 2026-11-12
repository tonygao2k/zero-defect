import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import type { AnalysisResult } from '../shared/analysis';
import type {
  BatchConfirmResult,
  ConfirmMistakeInput,
  EditableFields,
  MistakeStatus,
  MistakeSummary,
} from '../shared/mistakes';
import {
  listKnowledgePointsFor,
  type KnowledgePointOption,
} from './db/curriculum';

export type CauseRow = { code: string; label: string; description: string };

export type DraftInput = {
  paperId: string;
  /** 这道题所在的页(可能不止一页,如跨页题),按页序。 */
  pageIds: string[];
  analysis: AnalysisResult;
  grade: number;
  semester: number;
  curriculumId: string;
};

export type MistakeDetailRow = {
  id: string;
  status: MistakeStatus;
  paperId: string | null;
  paperTitle: string | null;
  incomplete: boolean;
  /** 这道题涉及的页的图片路径,按页序。 */
  imagePaths: string[];
  fields: Omit<EditableFields, 'mistakeId'>;
  analysis: AnalysisResult | null;
};

const now = () => new Date().toISOString();

/** 待确认 = 草稿,以及旧版本留下的“跳过了原因”。 */
const PENDING = "('draft','unattributed')";

export class MistakeRepo {
  constructor(readonly db: Database.Database) {}

  listActiveCauses(): CauseRow[] {
    return this.db
      .prepare(
        "SELECT code, label, COALESCE(description, '') AS description FROM root_causes WHERE active = 1 ORDER BY code",
      )
      .all() as CauseRow[];
  }

  knowledgePointsFor(
    curriculumId: string,
    grade: number,
  ): KnowledgePointOption[] {
    return listKnowledgePointsFor(this.db, curriculumId, grade);
  }

  /** 一份试卷识别出的所有错题整体落库:要么全部成功,要么全部不写。 */
  createDrafts(inputs: DraftInput[]): string[] {
    return this.db.transaction(() => inputs.map((i) => this.createDraft(i)))();
  }

  createDraft(input: DraftInput): string {
    const id = crypto.randomUUID();
    const a = input.analysis;
    const kp = this.db
      .prepare('SELECT id FROM knowledge_points WHERE code = ?')
      .get(a.knowledgePointCode) as { id: string } | undefined;
    const t = now();
    this.db
      .prepare(
        `INSERT INTO mistakes (id, paper_id, question_markdown, student_answer, student_work_markdown, correct_answer,
           grade, semester, subject, curriculum_id, knowledge_point_id, analysis_json, status, incomplete, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'math', ?, ?, ?, 'draft', ?, ?, ?)`,
      )
      .run(
        id,
        input.paperId,
        a.questionMarkdown,
        a.studentAnswer,
        a.studentWorkMarkdown,
        a.correctAnswer,
        input.grade,
        input.semester,
        input.curriculumId,
        kp?.id ?? null,
        JSON.stringify(a),
        a.incomplete ? 1 : 0,
        t,
        t,
      );
    const link = this.db.prepare(
      'INSERT INTO mistake_pages (mistake_id, page_id, position) VALUES (?, ?, ?)',
    );
    input.pageIds.forEach((pageId, i) => link.run(id, pageId, i));
    const insertCause = this.db.prepare(
      'INSERT INTO mistake_root_causes (mistake_id, root_cause_id, confidence, evidence, confirmed, is_primary) VALUES (?, ?, ?, ?, 0, 0)',
    );
    for (const c of a.rootCauses)
      insertCause.run(id, c.code, c.confidence, c.evidence);
    return id;
  }

  logRun(run: {
    type: string;
    input: unknown;
    output: string | null;
    model: string;
    status: 'ok' | 'failed';
    error?: string;
  }): void {
    this.db
      .prepare(
        'INSERT INTO ai_runs (id, run_type, input_json, output_json, model, status, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        crypto.randomUUID(),
        run.type,
        JSON.stringify(run.input),
        run.output,
        run.model,
        run.status,
        run.error ?? null,
        now(),
      );
  }

  private requireMistake(id: string): { status: MistakeStatus } {
    const row = this.db
      .prepare('SELECT status FROM mistakes WHERE id = ?')
      .get(id) as { status: MistakeStatus } | undefined;
    if (!row) throw new Error('找不到这道错题');
    return row;
  }

  private kpId(code: string): string {
    const kp = this.db
      .prepare('SELECT id FROM knowledge_points WHERE code = ? AND active = 1')
      .get(code) as { id: string } | undefined;
    if (!kp) throw new Error('知识点不存在,请重新选择');
    return kp.id;
  }

  /**
   * 家长确认:保存修改并标记主要原因。已确认的错题也可以再次确认(修改后重新保存)。
   * 掌握情况由作答记录推算(见 mastery.ts),这里不再单独写掌握度表。
   */
  confirm(input: ConfirmMistakeInput): void {
    this.requireMistake(input.mistakeId);
    const cause = this.db
      .prepare('SELECT id, active FROM root_causes WHERE code = ?')
      .get(input.rootCauseCode) as { id: string; active: number } | undefined;
    if (!cause) throw new Error('错误归因不存在,请重新选择');
    // needs_review 等保留项 active = 0,不能作为正式归因。
    if (!cause.active) throw new Error('请选择一个具体的错误归因');
    const kpId = this.kpId(input.knowledgePointCode);

    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE mistakes SET question_markdown = ?, student_answer = ?, student_work_markdown = ?, correct_answer = ?,
             knowledge_point_id = ?, status = 'active', updated_at = ? WHERE id = ?`,
        )
        .run(
          input.questionMarkdown,
          input.studentAnswer,
          input.studentWorkMarkdown,
          input.correctAnswer,
          kpId,
          now(),
          input.mistakeId,
        );
      this.db
        .prepare(
          'UPDATE mistake_root_causes SET is_primary = 0 WHERE mistake_id = ?',
        )
        .run(input.mistakeId);
      this.db
        .prepare(
          `INSERT INTO mistake_root_causes (mistake_id, root_cause_id, confidence, evidence, confirmed, is_primary)
           VALUES (?, ?, NULL, NULL, 1, 1)
           ON CONFLICT (mistake_id, root_cause_id) DO UPDATE SET confirmed = 1, is_primary = 1`,
        )
        .run(input.mistakeId, cause.id);
    })();
  }

  /**
   * 整份试卷批量确认:对每道待确认的题采用 AI 推荐的原因和知识点。
   * 没有推荐原因、知识点未确定(other)或题目不完整的跳过,留给家长逐题核对。
   */
  confirmAllInPaper(paperId: string): BatchConfirmResult {
    const ids = this.db
      .prepare(
        `SELECT id FROM mistakes WHERE paper_id = ? AND status IN ${PENDING}`,
      )
      .all(paperId) as { id: string }[];
    const result: BatchConfirmResult = { confirmed: 0, skipped: 0 };
    for (const { id } of ids) {
      if (this.confirmRecommended(id)) result.confirmed++;
      else result.skipped++;
    }
    return result;
  }

  /**
   * 直接采用 AI 推荐的原因和知识点确认这道题。
   * 返回 false 表示信息不够(没有推荐原因、知识点未确定、题目不完整),什么都没改,需要家长打开详情页补充。
   */
  confirmRecommended(id: string): boolean {
    const row = this.db
      .prepare(
        'SELECT analysis_json AS aj, incomplete FROM mistakes WHERE id = ?',
      )
      .get(id) as { aj: string | null; incomplete: number } | undefined;
    if (!row) throw new Error('找不到这道错题');
    let a: AnalysisResult | null = null;
    try {
      a = row.aj ? (JSON.parse(row.aj) as AnalysisResult) : null;
    } catch {
      a = null;
    }
    if (
      !a ||
      row.incomplete ||
      !a.recommendedRootCause ||
      a.knowledgePointCode === 'other'
    )
      return false;
    try {
      this.confirm({
        mistakeId: id,
        questionMarkdown: a.questionMarkdown,
        studentAnswer: a.studentAnswer,
        studentWorkMarkdown: a.studentWorkMarkdown,
        correctAnswer: a.correctAnswer,
        knowledgePointCode: a.knowledgePointCode,
        rootCauseCode: a.recommendedRootCause,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** 删除一道错题(待确认或已确认都可以)。图片属于试卷,不随错题删除。 */
  delete(id: string): void {
    this.requireMistake(id);
    this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE practice_questions SET source_mistake_id = NULL WHERE source_mistake_id = ?',
        )
        .run(id);
      this.db
        .prepare('DELETE FROM mistake_root_causes WHERE mistake_id = ?')
        .run(id);
      this.db.prepare('DELETE FROM mistakes WHERE id = ?').run(id);
    })();
  }

  /** 详情页用:当前字段、状态、所在页的图片路径和保存下来的 AI 分析结果。 */
  getDetail(id: string): MistakeDetailRow {
    const row = this.db
      .prepare(
        `SELECT m.id, m.status, m.paper_id AS paperId, p.title AS paperTitle, m.incomplete,
                m.question_markdown AS q, m.student_answer AS sa, m.student_work_markdown AS sw,
                m.correct_answer AS ca, m.analysis_json AS aj, kp.code AS kpCode
         FROM mistakes m
         LEFT JOIN knowledge_points kp ON kp.id = m.knowledge_point_id
         LEFT JOIN papers p ON p.id = m.paper_id
         WHERE m.id = ?`,
      )
      .get(id) as
      | {
          id: string;
          status: MistakeStatus;
          paperId: string | null;
          paperTitle: string | null;
          incomplete: number;
          q: string;
          sa: string | null;
          sw: string | null;
          ca: string | null;
          aj: string | null;
          kpCode: string | null;
        }
      | undefined;
    if (!row) throw new Error('找不到这道错题');
    let analysis: AnalysisResult | null = null;
    try {
      analysis = row.aj ? (JSON.parse(row.aj) as AnalysisResult) : null;
    } catch {
      analysis = null;
    }
    const imagePaths = (
      this.db
        .prepare(
          `SELECT pg.image_path AS imagePath FROM mistake_pages mp
           JOIN paper_pages pg ON pg.id = mp.page_id
           WHERE mp.mistake_id = ? ORDER BY pg.position`,
        )
        .all(id) as { imagePath: string }[]
    ).map((r) => r.imagePath);
    return {
      id: row.id,
      status: row.status,
      paperId: row.paperId,
      paperTitle: row.paperTitle,
      incomplete: row.incomplete === 1,
      imagePaths,
      fields: {
        questionMarkdown: row.q,
        studentAnswer: row.sa ?? '',
        studentWorkMarkdown: row.sw ?? '',
        correctAnswer: row.ca ?? '',
        knowledgePointCode: row.kpCode ?? 'other',
      },
      analysis,
    };
  }

  list(filter: {
    status?: 'pending' | 'confirmed';
    paperId?: string;
  }): MistakeSummary[] {
    const where: string[] = [];
    const args: string[] = [];
    if (filter.status === 'pending') where.push(`m.status IN ${PENDING}`);
    if (filter.status === 'confirmed') where.push("m.status = 'active'");
    if (filter.paperId) {
      where.push('m.paper_id = ?');
      args.push(filter.paperId);
    }
    const rows = this.db
      .prepare(
        `SELECT m.id, m.status, m.paper_id AS paperId, m.question_markdown AS questionMarkdown,
                m.incomplete, m.analysis_json AS aj, m.created_at AS createdAt,
                kp.label AS knowledgePointLabel,
                (SELECT rc.label FROM mistake_root_causes mrc JOIN root_causes rc ON rc.id = mrc.root_cause_id
                  WHERE mrc.mistake_id = m.id AND mrc.is_primary = 1) AS primaryRootCauseLabel
         FROM mistakes m LEFT JOIN knowledge_points kp ON kp.id = m.knowledge_point_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY m.created_at, m.rowid`,
      )
      .all(...args) as (Omit<
      MistakeSummary,
      'incomplete' | 'needsAttention'
    > & {
      incomplete: number;
      aj: string | null;
    })[];
    return rows.map(({ aj, incomplete, ...rest }) => ({
      ...rest,
      incomplete: incomplete === 1,
      needsAttention: needsAttention(rest.status, aj),
    }));
  }
}

/** 待确认且 AI 提示过风险(把握低、缺过程、没确定知识点等)的题,在列表里标出来。 */
function needsAttention(status: MistakeStatus, aj: string | null): boolean {
  if (status === 'active' || !aj) return false;
  try {
    const a = JSON.parse(aj) as AnalysisResult;
    return a.warnings.length > 0;
  } catch {
    return false;
  }
}
