import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import type { AnalysisResult } from '../shared/analysis';
import type {
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
  imagePath: string;
  imageHash: string;
  /** 去重键:图片哈希 + 补充说明。同一次分析产生的多道题共用同一个键。 */
  analysisKey: string;
  analysis: AnalysisResult;
  grade: number;
  curriculumId: string;
};

const now = () => new Date().toISOString();

export class MistakeRepo {
  constructor(readonly db: Database.Database) {}

  /** 同一次分析(同图同说明)产生的所有错题,按创建顺序。 */
  findByAnalysisKey(key: string): { id: string; status: MistakeStatus }[] {
    return this.db
      .prepare(
        'SELECT id, status FROM mistakes WHERE analysis_key = ? ORDER BY created_at, rowid',
      )
      .all(key) as { id: string; status: MistakeStatus }[];
  }

  /** 一次分析出多道题时整体落库:要么全部成功,要么全部不写。 */
  createDrafts(inputs: DraftInput[]): string[] {
    return this.db.transaction(() => inputs.map((i) => this.createDraft(i)))();
  }

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

  /** AI 分析完成后立即落库为草稿,家长确认前崩溃也能恢复(设计文档 3.2)。 */
  createDraft(input: DraftInput): string {
    const id = crypto.randomUUID();
    const a = input.analysis;
    const kp = this.db
      .prepare('SELECT id FROM knowledge_points WHERE code = ?')
      .get(a.knowledgePointCode) as { id: string } | undefined;
    const t = now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO mistakes (id, image_path, image_hash, analysis_key, question_markdown, student_answer, student_work_markdown,
             correct_answer, grade, subject, curriculum_id, knowledge_point_id, analysis_json, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'math', ?, ?, ?, 'draft', ?, ?)`,
        )
        .run(
          id,
          input.imagePath,
          input.imageHash,
          input.analysisKey,
          a.questionMarkdown,
          a.studentAnswer,
          a.studentWorkMarkdown,
          a.correctAnswer,
          input.grade,
          input.curriculumId,
          kp?.id ?? null,
          JSON.stringify(a),
          t,
          t,
        );
      const insertCause = this.db.prepare(
        'INSERT INTO mistake_root_causes (mistake_id, root_cause_id, confidence, evidence, confirmed, is_primary) VALUES (?, ?, ?, ?, 0, 0)',
      );
      for (const c of a.rootCauses)
        insertCause.run(id, c.code, c.confidence, c.evidence);
    })();
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

  private requireMistake(
    id: string,
    allowed: MistakeStatus[],
  ): { image_path: string | null; status: MistakeStatus } {
    const row = this.db
      .prepare('SELECT image_path, status FROM mistakes WHERE id = ?')
      .get(id) as
      | { image_path: string | null; status: MistakeStatus }
      | undefined;
    if (!row) throw new Error('找不到这道错题');
    if (!allowed.includes(row.status))
      throw new Error('这道错题当前状态不能执行此操作');
    return row;
  }

  private kpId(code: string): string {
    const kp = this.db
      .prepare('SELECT id FROM knowledge_points WHERE code = ? AND active = 1')
      .get(code) as { id: string } | undefined;
    if (!kp) throw new Error('知识点不存在,请重新选择');
    return kp.id;
  }

  private updateFields(
    f: EditableFields,
    kpId: string,
    status: MistakeStatus,
  ): void {
    this.db
      .prepare(
        `UPDATE mistakes SET question_markdown = ?, student_answer = ?, student_work_markdown = ?, correct_answer = ?,
           knowledge_point_id = ?, status = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        f.questionMarkdown,
        f.studentAnswer,
        f.studentWorkMarkdown,
        f.correctAnswer,
        kpId,
        status,
        now(),
        f.mistakeId,
      );
  }

  /** 家长确认:保存修改、标记主归因,并创建或重置对应的掌握度条目(设计文档第 10 节)。 */
  confirm(input: ConfirmMistakeInput): void {
    this.requireMistake(input.mistakeId, ['draft', 'unattributed']);
    const cause = this.db
      .prepare('SELECT id, active FROM root_causes WHERE code = ?')
      .get(input.rootCauseCode) as { id: string; active: number } | undefined;
    if (!cause) throw new Error('错误归因不存在,请重新选择');
    // needs_review 等保留项 active = 0,不能作为正式归因。
    if (!cause.active) throw new Error('请选择一个具体的错误归因');
    const kpId = this.kpId(input.knowledgePointCode);

    this.db.transaction(() => {
      this.updateFields(input, kpId, 'active');
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
      // 新条目 score = 1.0;已有条目说明孩子又在这个点上出错:回到 active、清零连对和复习等级,score 至少为 1.0。
      this.db
        .prepare(
          `INSERT INTO mastery (root_cause_id, knowledge_point_id) VALUES (?, ?)
           ON CONFLICT (root_cause_id, knowledge_point_id) DO UPDATE SET
             status = 'active', review_level = 0, consecutive_correct = 0, next_review_at = NULL,
             score = MAX(score, 1.0)`,
        )
        .run(cause.id, kpId);
    })();
  }

  /** 跳过归因:保存修改,状态为 unattributed,不写归因关联,不进入练习调度。 */
  skip(input: EditableFields): void {
    this.requireMistake(input.mistakeId, ['draft', 'unattributed']);
    const kpId = this.kpId(input.knowledgePointCode);
    this.db.transaction(() => {
      this.updateFields(input, kpId, 'unattributed');
      this.db
        .prepare('DELETE FROM mistake_root_causes WHERE mistake_id = ?')
        .run(input.mistakeId);
    })();
  }

  /** 放弃草稿:删除记录并返回图片路径,由调用方删除图片,使同一张图可以重新上传。 */
  discardDraft(id: string): string | null {
    const row = this.requireMistake(id, ['draft']);
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM mistake_root_causes WHERE mistake_id = ?')
        .run(id);
      this.db.prepare('DELETE FROM mistakes WHERE id = ?').run(id);
    })();
    // 同一次分析的多道题共用一张图片:还有别的错题在用时,不能让调用方删除它。
    if (!row.image_path) return null;
    const stillUsed = this.db
      .prepare('SELECT 1 FROM mistakes WHERE image_path = ? LIMIT 1')
      .get(row.image_path);
    return stillUsed ? null : row.image_path;
  }

  /** 确认页用:当前字段、状态、图片路径和保存下来的 AI 分析结果。 */
  getDetail(id: string): {
    id: string;
    status: MistakeStatus;
    imagePath: string | null;
    fields: Omit<EditableFields, 'mistakeId'>;
    analysis: AnalysisResult | null;
  } {
    const row = this.db
      .prepare(
        `SELECT m.id, m.status, m.image_path AS imagePath, m.question_markdown AS q, m.student_answer AS sa,
                m.student_work_markdown AS sw, m.correct_answer AS ca, m.analysis_json AS aj,
                kp.code AS kpCode
         FROM mistakes m LEFT JOIN knowledge_points kp ON kp.id = m.knowledge_point_id
         WHERE m.id = ?`,
      )
      .get(id) as
      | {
          id: string;
          status: MistakeStatus;
          imagePath: string | null;
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
    return {
      id: row.id,
      status: row.status,
      imagePath: row.imagePath,
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

  list(status?: MistakeStatus): MistakeSummary[] {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.status, m.question_markdown AS questionMarkdown, m.created_at AS createdAt,
                kp.label AS knowledgePointLabel,
                (SELECT rc.label FROM mistake_root_causes mrc JOIN root_causes rc ON rc.id = mrc.root_cause_id
                  WHERE mrc.mistake_id = m.id AND mrc.is_primary = 1) AS primaryRootCauseLabel
         FROM mistakes m LEFT JOIN knowledge_points kp ON kp.id = m.knowledge_point_id
         WHERE (? IS NULL OR m.status = ?)
         ORDER BY m.created_at DESC`,
      )
      .all(status ?? null, status ?? null);
    return rows as MistakeSummary[];
  }
}
