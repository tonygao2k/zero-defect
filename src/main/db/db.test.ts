import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from './open';
import { LATEST_VERSION, currentVersion, migrate } from './migrate';

describe('database migrations', () => {
  it('creates schema and seed data on a fresh database', () => {
    const db = openDatabase(':memory:');
    expect(currentVersion(db)).toBe(LATEST_VERSION);

    const causes = db
      .prepare('SELECT code, active FROM root_causes ORDER BY code')
      .all() as {
      code: string;
      active: number;
    }[];
    expect(causes).toHaveLength(13);
    expect(causes.find((c) => c.code === 'needs_review')?.active).toBe(0);
    expect(causes.filter((c) => c.active === 1)).toHaveLength(12);

    const other = db
      .prepare("SELECT stage FROM knowledge_points WHERE code = 'other'")
      .get() as { stage: string };
    expect(other.stage).toBe('any');
  });

  it('is idempotent when run again', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const n = db.prepare('SELECT COUNT(*) AS n FROM root_causes').get() as {
      n: number;
    };
    expect(n.n).toBe(13);
  });

  it('enforces foreign keys', () => {
    const db = openDatabase(':memory:');
    expect(() =>
      db
        .prepare(
          "INSERT INTO mistake_root_causes (mistake_id, root_cause_id) VALUES ('missing', 'carry_omission')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('rejects an invalid mistake status', () => {
    const db = openDatabase(':memory:');
    expect(() =>
      db
        .prepare(
          "INSERT INTO mistakes (id, question_markdown, status, created_at, updated_at) VALUES ('m', 'q', 'bogus', 'x', 'x')",
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  it('backs up an existing file before upgrading, and not on a fresh one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-db-'));
    const file = path.join(dir, 'app.sqlite');

    openDatabase(file).close();
    expect(fs.existsSync(path.join(dir, 'backups'))).toBe(false);

    // 模拟旧版本:真正停在 v3 的数据库,再用 openDatabase 打开应触发备份并升级。
    fs.rmSync(file);
    const old = new Database(file);
    old.pragma('foreign_keys = ON');
    migrate(old, undefined, 3);
    old.close();

    const db = openDatabase(file);
    expect(currentVersion(db)).toBe(LATEST_VERSION);
    expect(fs.readdirSync(path.join(dir, 'backups'))).toHaveLength(1);
    db.close();
  });
});
