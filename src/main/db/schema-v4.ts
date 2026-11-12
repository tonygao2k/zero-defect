import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { defaultPaperTitle } from '../../shared/papers';

/**
 * 迁移 4(设计文档 v3):
 * - 试卷 papers → 页 paper_pages(有序)→ 错题;错题与页多对多(一道题可能跨页)。
 * - app_settings:保存百炼 API Key(用户在界面输入,不再用系统钥匙串)。
 * - 错题增加学期、是否不完整;作答记录增加“跳过”标记;练习选择题的选项。
 * - 新增错误原因:未作答、乘法口诀不熟、余数大于除数、抄写或串行错误。
 * - practice_sessions 去掉“每天一条”的唯一约束(可以多次练习)。
 */
export const SCHEMA_V4 = `
CREATE TABLE papers (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  analysis_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','done','failed')),
  error_message TEXT,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  grade INTEGER,
  semester INTEGER,
  curriculum_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (curriculum_id) REFERENCES curricula(id)
);
CREATE INDEX idx_papers_key ON papers(analysis_key);

CREATE TABLE paper_pages (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  image_path TEXT NOT NULL,
  image_hash TEXT NOT NULL,
  UNIQUE (paper_id, position),
  FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
);

CREATE TABLE mistake_pages (
  mistake_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mistake_id, page_id),
  FOREIGN KEY (mistake_id) REFERENCES mistakes(id) ON DELETE CASCADE,
  FOREIGN KEY (page_id) REFERENCES paper_pages(id) ON DELETE CASCADE
);

ALTER TABLE mistakes ADD COLUMN paper_id TEXT REFERENCES papers(id);
ALTER TABLE mistakes ADD COLUMN semester INTEGER;
ALTER TABLE mistakes ADD COLUMN incomplete INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_mistakes_paper ON mistakes(paper_id);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

ALTER TABLE answer_attempts ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0;
ALTER TABLE practice_questions ADD COLUMN options_json TEXT;

CREATE TABLE practice_sessions_new (
  id TEXT PRIMARY KEY,
  practice_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  completed_at TEXT
);
INSERT INTO practice_sessions_new SELECT id, practice_date, status, created_at, completed_at FROM practice_sessions;
DROP TABLE practice_sessions;
ALTER TABLE practice_sessions_new RENAME TO practice_sessions;
`;

export const ROOT_CAUSES_V4: {
  code: string;
  label: string;
  description: string;
}[] = [
  {
    code: 'not_attempted',
    label: '未作答',
    description: '题目空着没有做,不确定是不会做还是漏做了',
  },
  {
    code: 'times_table_recall',
    label: '乘法口诀不熟',
    description: '表内乘除法的结果想不起来或记错',
  },
  {
    code: 'remainder_ge_divisor',
    label: '余数大于除数',
    description: '有余数的除法中,余数不小于除数,商还可以再大一些',
  },
  {
    code: 'copy_error',
    label: '抄写或串行错误',
    description: '把题目的数字抄错、抄漏,或看错了行',
  },
];

/** 旧数据:同一张图片的错题归为一份试卷(一页),名称按创建时间生成。 */
function groupLegacyMistakes(db: Database.Database): void {
  const groups = db
    .prepare(
      `SELECT image_path AS imagePath, MIN(analysis_key) AS analysisKey, MIN(image_hash) AS imageHash,
              MIN(created_at) AS createdAt, MIN(grade) AS grade, MIN(curriculum_id) AS curriculumId
       FROM mistakes WHERE image_path IS NOT NULL GROUP BY image_path`,
    )
    .all() as {
    imagePath: string;
    analysisKey: string | null;
    imageHash: string | null;
    createdAt: string;
    grade: number | null;
    curriculumId: string | null;
  }[];

  const insertPaper = db.prepare(
    `INSERT INTO papers (id, title, analysis_key, status, grade, curriculum_id, created_at, updated_at)
     VALUES (?, ?, ?, 'done', ?, ?, ?, ?)`,
  );
  const insertPage = db.prepare(
    'INSERT INTO paper_pages (id, paper_id, position, image_path, image_hash) VALUES (?, ?, 0, ?, ?)',
  );
  const setPaper = db.prepare(
    'UPDATE mistakes SET paper_id = ? WHERE image_path = ?',
  );
  const link = db.prepare(
    `INSERT INTO mistake_pages (mistake_id, page_id, position)
     SELECT id, ?, 0 FROM mistakes WHERE image_path = ?`,
  );

  for (const g of groups) {
    const paperId = crypto.randomUUID();
    const pageId = crypto.randomUUID();
    const key = g.analysisKey ?? g.imageHash ?? g.imagePath;
    insertPaper.run(
      paperId,
      defaultPaperTitle(new Date(g.createdAt)),
      key,
      g.grade,
      g.curriculumId,
      g.createdAt,
      g.createdAt,
    );
    insertPage.run(pageId, paperId, g.imagePath, g.imageHash ?? key);
    setPaper.run(paperId, g.imagePath);
    link.run(pageId, g.imagePath);
  }
}

export function migrateV4(db: Database.Database): void {
  db.exec(SCHEMA_V4);
  const insertCause = db.prepare(
    'INSERT INTO root_causes (id, code, label, description, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
  );
  const now = new Date().toISOString();
  for (const c of ROOT_CAUSES_V4)
    insertCause.run(c.code, c.code, c.label, c.description, now);
  groupLegacyMistakes(db);
}
