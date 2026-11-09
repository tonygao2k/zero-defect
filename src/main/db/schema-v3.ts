/**
 * 迁移 3:一张照片(一张卷子)可以对应多道错题,所以 mistakes.image_hash 不能再唯一。
 * - image_hash:图片本身的内容哈希,可重复。
 * - analysis_key:一次分析的去重键 = 图片哈希 + 家长的补充说明;同图同说明才算重复上传。
 * SQLite 不能直接去掉列上的 UNIQUE,按官方推荐的方式重建表。已有数据的 analysis_key 取原来的 image_hash。
 */
export const SCHEMA_V3 = `
CREATE TABLE mistakes_new (
  id TEXT PRIMARY KEY,
  image_path TEXT,
  image_hash TEXT,
  analysis_key TEXT,
  question_markdown TEXT NOT NULL,
  student_answer TEXT,
  student_work_markdown TEXT,
  correct_answer TEXT,
  grade INTEGER,
  subject TEXT NOT NULL DEFAULT 'math',
  curriculum_id TEXT,
  knowledge_point_id TEXT,
  analysis_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','unattributed','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (curriculum_id) REFERENCES curricula(id),
  FOREIGN KEY (knowledge_point_id) REFERENCES knowledge_points(id)
);

INSERT INTO mistakes_new (
  id, image_path, image_hash, analysis_key, question_markdown, student_answer, student_work_markdown,
  correct_answer, grade, subject, curriculum_id, knowledge_point_id, analysis_json, status, created_at, updated_at
)
SELECT
  id, image_path, image_hash, image_hash, question_markdown, student_answer, student_work_markdown,
  correct_answer, grade, subject, curriculum_id, knowledge_point_id, analysis_json, status, created_at, updated_at
FROM mistakes;

DROP TABLE mistakes;
ALTER TABLE mistakes_new RENAME TO mistakes;

CREATE INDEX idx_mistakes_status ON mistakes(status, created_at);
CREATE INDEX idx_mistakes_analysis_key ON mistakes(analysis_key);
`;
