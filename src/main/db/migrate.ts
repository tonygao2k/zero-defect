import type Database from 'better-sqlite3';
import { SCHEMA_V1 } from './schema';
import { SCHEMA_V3 } from './schema-v3';
import { migrateV4 } from './schema-v4';
import {
  CURRICULUM_SEEDS,
  GENERIC_KNOWLEDGE_POINTS,
  PEP_PRIMARY_MATH,
  ROOT_CAUSE_SEEDS,
} from './seed';

type Migration = {
  version: number;
  /** 需要重建被其他表引用的表时设为 true:迁移期间临时关闭外键,提交前做完整性检查。 */
  foreignKeysOff?: boolean;
  up: (db: Database.Database) => void;
};

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
  {
    version: 3,
    foreignKeysOff: true,
    up: (db) => {
      db.exec(SCHEMA_V3);
    },
  },
  {
    version: 4,
    foreignKeysOff: true,
    up: migrateV4,
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
 * `targetVersion` 只在测试里用来停在某个旧版本。
 */
export function migrate(
  db: Database.Database,
  beforeUpgrade?: (fromVersion: number) => void,
  targetVersion: number = LATEST_VERSION,
): void {
  const from = currentVersion(db);
  const pending = MIGRATIONS.filter(
    (m) => m.version > from && m.version <= targetVersion,
  );
  if (pending.length === 0) return;
  if (from > 0) beforeUpgrade?.(from);

  const record = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );
  for (const m of pending) {
    // PRAGMA foreign_keys 在事务内无效,必须在事务外切换。
    const restoreForeignKeys =
      m.foreignKeysOff && db.pragma('foreign_keys', { simple: true }) === 1;
    if (m.foreignKeysOff) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        m.up(db);
        if (m.foreignKeysOff) {
          const violations = db.pragma('foreign_key_check') as unknown[];
          if (violations.length > 0) {
            throw new Error(`迁移 ${m.version} 后外键检查未通过,已回滚`);
          }
        }
        record.run(m.version, new Date().toISOString());
      })();
    } finally {
      if (restoreForeignKeys) db.pragma('foreign_keys = ON');
    }
  }
}
