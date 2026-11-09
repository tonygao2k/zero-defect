import type Database from 'better-sqlite3';
import { SCHEMA_V1 } from './schema';
import {
  CURRICULUM_SEEDS,
  GENERIC_KNOWLEDGE_POINTS,
  PEP_PRIMARY_MATH,
  ROOT_CAUSE_SEEDS,
} from './seed';

type Migration = { version: number; up: (db: Database.Database) => void };

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(SCHEMA_V1);
    },
  },
  {
    version: 2,
    up: (db) => {
      const now = new Date().toISOString();
      const insertCause = db.prepare(
        'INSERT INTO root_causes (id, code, label, description, active, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const s of ROOT_CAUSE_SEEDS) {
        insertCause.run(s.code, s.code, s.label, s.description, s.active, now);
      }
      const insertCurriculum = db.prepare(
        "INSERT INTO curricula (id, stage, subject, edition, label) VALUES (?, ?, 'math', ?, ?)",
      );
      for (const c of CURRICULUM_SEEDS)
        insertCurriculum.run(c.id, c.stage, c.edition, c.label);

      const insertKp = db.prepare(
        "INSERT INTO knowledge_points (id, code, label, stage, subject) VALUES (?, ?, ?, ?, 'math')",
      );
      for (const k of GENERIC_KNOWLEDGE_POINTS)
        insertKp.run(k.code, k.code, k.label, 'any');

      const insertPlacement = db.prepare(
        'INSERT INTO curriculum_knowledge_points (curriculum_id, knowledge_point_id, grade, semester, sort_order) VALUES (?, ?, ?, ?, ?)',
      );
      PEP_PRIMARY_MATH.forEach(([grade, semester, code, label], index) => {
        insertKp.run(code, code, label, 'primary');
        insertPlacement.run('pep_primary_math', code, grade, semester, index);
      });
    },
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function currentVersion(db: Database.Database): number {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const row = db
    .prepare('SELECT MAX(version) AS v FROM schema_migrations')
    .get() as { v: number | null };
  return row.v ?? 0;
}

/**
 * 依次执行未执行的迁移,每个迁移在独立事务里,失败整体回滚。
 * `beforeUpgrade` 在确有待执行迁移、且不是全新数据库时调用,用来备份文件。
 */
export function migrate(
  db: Database.Database,
  beforeUpgrade?: (fromVersion: number) => void,
): void {
  const from = currentVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > from);
  if (pending.length === 0) return;
  if (from > 0) beforeUpgrade?.(from);

  const record = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );
  for (const m of pending) {
    db.transaction(() => {
      m.up(db);
      record.run(m.version, new Date().toISOString());
    })();
  }
}
