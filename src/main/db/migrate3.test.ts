import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { LATEST_VERSION, currentVersion, migrate } from './migrate';

/** 先停在版本 2,放进旧结构的数据,再升级到最新版本。 */
function dbAtV2() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db, undefined, 2);
  expect(currentVersion(db)).toBe(2);

  db.exec(`
    INSERT INTO mistakes (id, image_path, image_hash, question_markdown, student_answer, grade, curriculum_id,
                          knowledge_point_id, status, created_at, updated_at)
    VALUES ('m1', '/img/a.jpg', 'hash-a', '计算 23×14', '312', 3, 'pep_primary_math', 'mul_two_digit', 'active', 't', 't');
    INSERT INTO mistake_root_causes (mistake_id, root_cause_id, confidence, evidence, confirmed, is_primary)
    VALUES ('m1', 'carry_omission', 0.8, '漏进位', 1, 1);
    INSERT INTO mastery (root_cause_id, knowledge_point_id, score) VALUES ('carry_omission', 'mul_two_digit', 1.5);
  `);
  // 旧结构:image_hash 唯一。
  expect(() =>
    db
      .prepare(
        "INSERT INTO mistakes (id, image_hash, question_markdown, created_at, updated_at) VALUES ('dup', 'hash-a', 'q', 't', 't')",
      )
      .run(),
  ).toThrow(/UNIQUE/);
  return db;
}

describe('migration 3 (many mistakes per image)', () => {
  it('keeps existing rows, relations and mastery, and copies image_hash into analysis_key', () => {
    const db = dbAtV2();
    migrate(db);
    expect(currentVersion(db)).toBe(LATEST_VERSION);

    const row = db
      .prepare(
        'SELECT id, image_hash, analysis_key, status, question_markdown FROM mistakes',
      )
      .get();
    expect(row).toEqual({
      id: 'm1',
      image_hash: 'hash-a',
      analysis_key: 'hash-a',
      status: 'active',
      question_markdown: '计算 23×14',
    });
    expect(
      db.prepare('SELECT mistake_id, confirmed FROM mistake_root_causes').get(),
    ).toEqual({
      mistake_id: 'm1',
      confirmed: 1,
    });
    expect(db.prepare('SELECT score FROM mastery').get()).toEqual({
      score: 1.5,
    });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('allows several mistakes to share one image hash', () => {
    const db = dbAtV2();
    migrate(db);
    const insert = db.prepare(
      "INSERT INTO mistakes (id, image_hash, analysis_key, question_markdown, created_at, updated_at) VALUES (?, 'hash-a', ?, 'q', 't', 't')",
    );
    insert.run('m2', 'key-1');
    insert.run('m3', 'key-2');
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM mistakes WHERE image_hash = 'hash-a'",
        )
        .get(),
    ).toEqual({ n: 3 });
  });

  it('restores foreign key enforcement and keeps referencing tables intact', () => {
    const db = dbAtV2();
    migrate(db);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() =>
      db
        .prepare(
          "INSERT INTO mistake_root_causes (mistake_id, root_cause_id) VALUES ('missing', 'carry_omission')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
    // 子表仍然引用名为 mistakes 的表,而不是迁移过程中的临时表。
    const sql = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE name = 'mistake_root_causes'",
      )
      .get() as {
      sql: string;
    };
    expect(sql.sql).toContain('REFERENCES mistakes');
    expect(sql.sql).not.toContain('mistakes_new');
  });

  it('does not leave foreign keys off when the migration fails', () => {
    const db = dbAtV2();
    // 制造一条会让外键检查失败的数据(外键关闭时插入的孤儿记录)。
    db.pragma('foreign_keys = OFF');
    db.exec(
      "INSERT INTO mistake_root_causes (mistake_id, root_cause_id) VALUES ('ghost', 'carry_omission')",
    );
    db.pragma('foreign_keys = ON');

    expect(() => migrate(db)).toThrow(/外键检查/);
    expect(currentVersion(db)).toBe(2); // 已回滚
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'mistakes_new'",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it('creates the lookup index on analysis_key', () => {
    const db = new Database(':memory:');
    migrate(db);
    const idx = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_mistakes_analysis_key'",
      )
      .get();
    expect(idx).toBeDefined();
  });
});
