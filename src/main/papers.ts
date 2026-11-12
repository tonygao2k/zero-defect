import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import type { PaperStatus, PaperSummary } from '../shared/papers';

export type PaperRow = {
  id: string;
  title: string;
  analysisKey: string;
  status: PaperStatus;
  errorMessage: string | null;
  skippedCount: number;
  grade: number | null;
  semester: number | null;
  curriculumId: string | null;
  createdAt: string;
};

export type PageRow = {
  id: string;
  position: number;
  imagePath: string;
  imageHash: string;
};

/** 当前学期:同年级,且学期相同(旧数据没有学期,视为通用)。 */
export type Term = { grade: number; semester: number };

const now = () => new Date().toISOString();

const PAPER_COLUMNS = `id, title, analysis_key AS analysisKey, status, error_message AS errorMessage,
  skipped_count AS skippedCount, grade, semester, curriculum_id AS curriculumId, created_at AS createdAt`;

export class PaperRepo {
  constructor(readonly db: Database.Database) {}

  findByKey(key: string): PaperRow | undefined {
    return this.db
      .prepare(
        `SELECT ${PAPER_COLUMNS} FROM papers WHERE analysis_key = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(key) as PaperRow | undefined;
  }

  get(id: string): PaperRow {
    const row = this.db
      .prepare(`SELECT ${PAPER_COLUMNS} FROM papers WHERE id = ?`)
      .get(id) as PaperRow | undefined;
    if (!row) throw new Error('找不到这份试卷');
    return row;
  }

  /** 试卷和它的页在同一个事务里写入:要么都有,要么都没有。 */
  create(input: {
    title: string;
    analysisKey: string;
    grade: number;
    semester: number;
    curriculumId: string;
    pages: { imagePath: string; imageHash: string }[];
  }): string {
    const id = crypto.randomUUID();
    const t = now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO papers (id, title, analysis_key, status, grade, semester, curriculum_id, created_at, updated_at)
           VALUES (?, ?, ?, 'processing', ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.title,
          input.analysisKey,
          input.grade,
          input.semester,
          input.curriculumId,
          t,
          t,
        );
      const insertPage = this.db.prepare(
        'INSERT INTO paper_pages (id, paper_id, position, image_path, image_hash) VALUES (?, ?, ?, ?, ?)',
      );
      input.pages.forEach((p, i) =>
        insertPage.run(crypto.randomUUID(), id, i, p.imagePath, p.imageHash),
      );
    })();
    return id;
  }

  pages(paperId: string): PageRow[] {
    return this.db
      .prepare(
        `SELECT id, position, image_path AS imagePath, image_hash AS imageHash
         FROM paper_pages WHERE paper_id = ? ORDER BY position`,
      )
      .all(paperId) as PageRow[];
  }

  setStatus(
    id: string,
    status: PaperStatus,
    extra: { errorMessage?: string | null; skippedCount?: number } = {},
  ): void {
    this.db
      .prepare(
        `UPDATE papers SET status = ?, error_message = ?, skipped_count = COALESCE(?, skipped_count), updated_at = ? WHERE id = ?`,
      )
      .run(
        status,
        extra.errorMessage ?? null,
        extra.skippedCount ?? null,
        now(),
        id,
      );
  }

  /** 应用上次退出时还在识别中的试卷,标记为失败,家长可以点“重试”。 */
  recoverInterrupted(): number {
    return this.db
      .prepare(
        `UPDATE papers SET status = 'failed', error_message = '识别被中断了,请点重试', updated_at = ? WHERE status = 'processing'`,
      )
      .run(now()).changes;
  }

  rename(id: string, title: string): void {
    const r = this.db
      .prepare('UPDATE papers SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, now(), id);
    if (r.changes === 0) throw new Error('找不到这份试卷');
  }

  /**
   * 删除试卷及其所有错题和页,返回要删除的图片路径(由调用方删文件)。
   * 引用这些错题的练习题保留,只解除关联。
   */
  delete(id: string): string[] {
    this.get(id);
    const paths = this.pages(id).map((p) => p.imagePath);
    this.db.transaction(() => {
      const ids = (
        this.db
          .prepare('SELECT id FROM mistakes WHERE paper_id = ?')
          .all(id) as { id: string }[]
      ).map((r) => r.id);
      const unlink = this.db.prepare(
        'UPDATE practice_questions SET source_mistake_id = NULL WHERE source_mistake_id = ?',
      );
      const delCauses = this.db.prepare(
        'DELETE FROM mistake_root_causes WHERE mistake_id = ?',
      );
      const delMistake = this.db.prepare('DELETE FROM mistakes WHERE id = ?');
      for (const m of ids) {
        unlink.run(m);
        delCauses.run(m);
        delMistake.run(m);
      }
      this.db.prepare('DELETE FROM papers WHERE id = ?').run(id);
    })();
    return paths;
  }

  /** 标签列表:按创建时间倒序。allTerms 为 false 时只列当前学期。 */
  list(term: Term, allTerms: boolean): PaperSummary[] {
    return this.db
      .prepare(
        `SELECT p.id, p.title, p.status, p.error_message AS errorMessage, p.created_at AS createdAt,
                (SELECT COUNT(*) FROM mistakes m WHERE m.paper_id = p.id) AS totalCount,
                (SELECT COUNT(*) FROM mistakes m WHERE m.paper_id = p.id AND m.status IN ('draft','unattributed')) AS pendingCount
         FROM papers p
         WHERE (? = 1 OR (p.grade = ? AND (p.semester IS NULL OR p.semester = ?)))
         ORDER BY p.created_at DESC, p.rowid DESC`,
      )
      .all(allTerms ? 1 : 0, term.grade, term.semester) as PaperSummary[];
  }
}
