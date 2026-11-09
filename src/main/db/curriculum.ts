import type Database from 'better-sqlite3';

export type KnowledgePointOption = {
  id: string;
  code: string;
  label: string;
  /** 通用知识点(如 other)没有年级和学期。 */
  grade: number | null;
  semester: number | null;
};

/**
 * 某教材下、不高于指定年级的知识点,再加上各学段通用的知识点。
 * 包含低年级内容,是因为高年级的错题常常源于低年级的基本功(如表内乘法)。
 */
export function listKnowledgePointsFor(
  db: Database.Database,
  curriculumId: string,
  grade: number,
): KnowledgePointOption[] {
  const placed = db
    .prepare(
      `SELECT kp.id, kp.code, kp.label, ck.grade, ck.semester
       FROM curriculum_knowledge_points ck
       JOIN knowledge_points kp ON kp.id = ck.knowledge_point_id
       WHERE ck.curriculum_id = ? AND ck.grade <= ? AND kp.active = 1
       ORDER BY ck.grade, ck.semester, ck.sort_order`,
    )
    .all(curriculumId, grade) as KnowledgePointOption[];

  const generic = db
    .prepare(
      `SELECT id, code, label, NULL AS grade, NULL AS semester
       FROM knowledge_points WHERE stage = 'any' AND active = 1 ORDER BY code`,
    )
    .all() as KnowledgePointOption[];

  return [...placed, ...generic];
}
