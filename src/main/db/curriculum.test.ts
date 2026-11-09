import { describe, expect, it } from 'vitest';
import { openDatabase } from './open';
import { listKnowledgePointsFor } from './curriculum';
import { PEP_PRIMARY_MATH } from './seed';

describe('curriculum seed', () => {
  it('has unique codes and valid grade/semester ranges', () => {
    const codes = PEP_PRIMARY_MATH.map((p) => p[2]);
    expect(new Set(codes).size).toBe(codes.length);
    for (const [grade, semester] of PEP_PRIMARY_MATH) {
      expect(grade).toBeGreaterThanOrEqual(1);
      expect(grade).toBeLessThanOrEqual(6);
      expect([1, 2]).toContain(semester);
    }
  });

  it('covers both semesters of every primary grade', () => {
    for (let grade = 1; grade <= 6; grade++) {
      for (const semester of [1, 2]) {
        expect(
          PEP_PRIMARY_MATH.some((p) => p[0] === grade && p[1] === semester),
        ).toBe(true);
      }
    }
  });

  it('is fully loaded into the database', () => {
    const db = openDatabase(':memory:');
    const placed = db
      .prepare('SELECT COUNT(*) AS n FROM curriculum_knowledge_points')
      .get() as { n: number };
    expect(placed.n).toBe(PEP_PRIMARY_MATH.length);
    const curriculum = db
      .prepare(
        "SELECT stage, edition FROM curricula WHERE id = 'pep_primary_math'",
      )
      .get();
    expect(curriculum).toEqual({ stage: 'primary', edition: '人教版' });
  });
});

describe('listKnowledgePointsFor', () => {
  const db = openDatabase(':memory:');

  it('includes lower grades and generic points, but not higher grades', () => {
    const codes = listKnowledgePointsFor(db, 'pep_primary_math', 3).map(
      (k) => k.code,
    );
    expect(codes).toContain('mul_table'); // 二年级基本功
    expect(codes).toContain('mul_two_digit'); // 三年级下册
    expect(codes).toContain('other'); // 通用
    expect(codes).not.toContain('fraction_mul'); // 六年级
  });

  it('puts generic points last and returns nothing placed for an unknown curriculum', () => {
    const list = listKnowledgePointsFor(db, 'pep_primary_math', 6);
    expect(list[list.length - 1].code).toBe('other');
    const none = listKnowledgePointsFor(db, 'no_such_curriculum', 6);
    expect(none.map((k) => k.code)).toEqual(['other']);
  });

  it('can host another stage without touching existing data', () => {
    const extra = openDatabase(':memory:');
    extra.exec(`
      INSERT INTO curricula (id, stage, edition, label) VALUES ('pep_junior_math', 'junior', '人教版', '人教版初中数学');
      INSERT INTO knowledge_points (id, code, label, stage) VALUES ('linear_equation', 'linear_equation', '一元一次方程', 'junior');
      INSERT INTO curriculum_knowledge_points VALUES ('pep_junior_math', 'linear_equation', 7, 1, 0);
    `);
    expect(
      listKnowledgePointsFor(extra, 'pep_junior_math', 7).map((k) => k.code),
    ).toEqual(['linear_equation', 'other']);
    expect(
      listKnowledgePointsFor(extra, 'pep_primary_math', 6).map((k) => k.code),
    ).not.toContain('linear_equation');
  });
});
