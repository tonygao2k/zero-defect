import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { currentVersion, migrate } from './migrate';

function v3Database(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db, undefined, 3);
  return db;
}

const insertLegacy = (
  db: Database.Database,
  id: string,
  imagePath: string,
  key: string,
  createdAt: string,
) =>
  db
    .prepare(
      `INSERT INTO mistakes (id, image_path, image_hash, analysis_key, question_markdown, grade, curriculum_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'q', 3, 'pep_primary_math', 'active', ?, ?)`,
    )
    .run(id, imagePath, key, key, createdAt, createdAt);

describe('migration 4', () => {
  it('adds the new root causes and keeps the old ones', () => {
    const db = v3Database();
    migrate(db);
    expect(currentVersion(db)).toBe(4);
    const codes = (
      db.prepare('SELECT code FROM root_causes WHERE active = 1').all() as {
        code: string;
      }[]
    ).map((r) => r.code);
    for (const c of [
      'not_attempted',
      'times_table_recall',
      'remainder_ge_divisor',
      'copy_error',
      'carry_omission',
    ])
      expect(codes).toContain(c);
  });

  it('groups legacy mistakes that share an image into one paper', () => {
    const db = v3Database();
    insertLegacy(db, 'm1', '/img/a.jpg', 'k1', '2026-11-01T08:00:00.000Z');
    insertLegacy(db, 'm2', '/img/a.jpg', 'k1', '2026-11-01T08:00:00.000Z');
    insertLegacy(db, 'm3', '/img/b.jpg', 'k2', '2026-11-02T08:00:00.000Z');
    migrate(db);

    const papers = db.prepare('SELECT * FROM papers').all() as {
      id: string;
      status: string;
      analysis_key: string;
    }[];
    expect(papers).toHaveLength(2);
    expect(papers.every((p) => p.status === 'done')).toBe(true);

    const paperOf = (id: string) =>
      (
        db
          .prepare('SELECT paper_id AS p FROM mistakes WHERE id = ?')
          .get(id) as {
          p: string;
        }
      ).p;
    expect(paperOf('m1')).toBe(paperOf('m2'));
    expect(paperOf('m1')).not.toBe(paperOf('m3'));

    const links = db
      .prepare('SELECT COUNT(*) AS n FROM mistake_pages')
      .get() as {
      n: number;
    };
    expect(links.n).toBe(3);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('lets one mistake span several pages', () => {
    const db = v3Database();
    migrate(db);
    db.exec(`
      INSERT INTO papers (id, title, analysis_key, created_at, updated_at) VALUES ('p', 't', 'k', 'x', 'x');
      INSERT INTO paper_pages (id, paper_id, position, image_path, image_hash) VALUES ('g1','p',0,'/1.jpg','h1'), ('g2','p',1,'/2.jpg','h2');
      INSERT INTO mistakes (id, paper_id, question_markdown, created_at, updated_at) VALUES ('m','p','q','x','x');
      INSERT INTO mistake_pages (mistake_id, page_id, position) VALUES ('m','g1',0), ('m','g2',1);
    `);
    const n = db
      .prepare('SELECT COUNT(*) AS n FROM mistake_pages WHERE mistake_id = ?')
      .get('m') as { n: number };
    expect(n.n).toBe(2);
    // 删除试卷时,页和错题与页的关联一起清理。
    db.exec(
      "DELETE FROM mistakes WHERE id = 'm'; DELETE FROM papers WHERE id = 'p'",
    );
    expect(
      (
        db.prepare('SELECT COUNT(*) AS n FROM paper_pages').get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
  });

  it('allows several practice sessions on the same day', () => {
    const db = v3Database();
    migrate(db);
    const insert = db.prepare(
      "INSERT INTO practice_sessions (id, practice_date, created_at) VALUES (?, '2026-11-12', 'x')",
    );
    insert.run('s1');
    expect(() => insert.run('s2')).not.toThrow();
  });
});
