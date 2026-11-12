import { beforeEach, describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../shared/analysis';
import { openDatabase } from './db/open';
import { MistakeRepo } from './mistakes';
import { PaperRepo } from './papers';

let repo: MistakeRepo;
let papers: PaperRepo;
let paperId: string;
let pageId: string;

const analysis = (over: Partial<AnalysisResult> = {}): AnalysisResult => ({
  label: '第3题',
  questionMarkdown: '计算 $23 \\times 14$',
  studentAnswer: '312',
  studentWorkMarkdown: '23×4=92',
  correctAnswer: '322',
  knowledgePointCode: 'mul_two_digit',
  hasStudentWork: true,
  pages: [0],
  incomplete: false,
  rootCauses: [
    {
      code: 'carry_omission',
      confidence: 0.85,
      evidence: '漏了进位',
      unknownFromModel: false,
    },
  ],
  recommendedRootCause: 'carry_omission',
  warnings: [],
  ...over,
});

const draft = (over: Partial<AnalysisResult> = {}, pid = paperId) =>
  repo.createDraft({
    paperId: pid,
    pageIds: [pageId],
    analysis: analysis(over),
    grade: 3,
    semester: 1,
    curriculumId: 'pep_primary_math',
  });

const confirmInput = (id: string, over: Record<string, string> = {}) => ({
  mistakeId: id,
  questionMarkdown: '计算 $23 \\times 14$',
  studentAnswer: '312',
  studentWorkMarkdown: '',
  correctAnswer: '322',
  knowledgePointCode: 'mul_two_digit',
  rootCauseCode: 'carry_omission',
  ...over,
});

beforeEach(() => {
  const db = openDatabase(':memory:');
  repo = new MistakeRepo(db);
  papers = new PaperRepo(db);
  paperId = papers.create({
    title: '期末卷',
    analysisKey: 'k',
    grade: 3,
    semester: 1,
    curriculumId: 'pep_primary_math',
    pages: [{ imagePath: '/a.jpg', imageHash: 'h' }],
  });
  pageId = papers.pages(paperId)[0].id;
});

describe('MistakeRepo.confirm', () => {
  it('activates the mistake, marks the primary cause, and applies edits', () => {
    const id = draft();
    repo.confirm(confirmInput(id, { correctAnswer: '322(已核对)' }));
    const d = repo.getDetail(id);
    expect(d.status).toBe('active');
    expect(d.fields.correctAnswer).toBe('322(已核对)');
    const cause = repo.db
      .prepare(
        'SELECT confirmed, is_primary FROM mistake_root_causes WHERE mistake_id = ? AND root_cause_id = ?',
      )
      .get(id, 'carry_omission');
    expect(cause).toEqual({ confirmed: 1, is_primary: 1 });
  });

  it('lets the parent pick a cause the model did not suggest, and re-confirm later', () => {
    const id = draft();
    repo.confirm(confirmInput(id, { rootCauseCode: 'copy_error' }));
    repo.confirm(confirmInput(id, { rootCauseCode: 'times_table_recall' }));
    const primary = repo.db
      .prepare(
        'SELECT root_cause_id AS c FROM mistake_root_causes WHERE mistake_id = ? AND is_primary = 1',
      )
      .all(id);
    expect(primary).toEqual([{ c: 'times_table_recall' }]);
  });

  it('rejects needs_review, unknown causes and unknown knowledge points', () => {
    const id = draft();
    expect(() =>
      repo.confirm(confirmInput(id, { rootCauseCode: 'needs_review' })),
    ).toThrow(/具体的错误归因/);
    expect(() =>
      repo.confirm(confirmInput(id, { rootCauseCode: 'nope' })),
    ).toThrow(/不存在/);
    expect(() =>
      repo.confirm(confirmInput(id, { knowledgePointCode: 'nope' })),
    ).toThrow(/知识点不存在/);
    expect(repo.getDetail(id).status).toBe('draft');
  });
});

describe('MistakeRepo.confirmRecommended', () => {
  it('confirms in one step using the AI recommendation', () => {
    const id = draft();
    expect(repo.confirmRecommended(id)).toBe(true);
    const d = repo.getDetail(id);
    expect(d.status).toBe('active');
    expect(d.fields.knowledgePointCode).toBe('mul_two_digit');
    const primary = repo.db
      .prepare(
        'SELECT root_cause_id AS c FROM mistake_root_causes WHERE mistake_id = ? AND is_primary = 1',
      )
      .get(id);
    expect(primary).toEqual({ c: 'carry_omission' });
  });

  it('confirms even when the AI flagged low confidence', () => {
    const id = draft({ warnings: ['归因把握不高,请家长仔细核对'] });
    expect(repo.confirmRecommended(id)).toBe(true);
  });

  it('changes nothing when information is missing', () => {
    for (const over of [
      { recommendedRootCause: null },
      { knowledgePointCode: 'other' },
      { incomplete: true },
    ]) {
      const id = draft(over);
      expect(repo.confirmRecommended(id)).toBe(false);
      expect(repo.getDetail(id).status).toBe('draft');
    }
  });

  it('rejects an unknown mistake', () => {
    expect(() => repo.confirmRecommended('nope')).toThrow(/找不到/);
  });
});

describe('MistakeRepo.confirmAllInPaper', () => {
  it('confirms what the model recommended and leaves risky ones for the parent', () => {
    const ok = draft();
    const noCause = draft({ recommendedRootCause: null });
    const unknownKp = draft({ knowledgePointCode: 'other' });
    const incomplete = draft({ incomplete: true });
    const res = repo.confirmAllInPaper(paperId);
    expect(res).toEqual({ confirmed: 1, skipped: 3 });
    expect(repo.getDetail(ok).status).toBe('active');
    for (const id of [noCause, unknownKp])
      expect(repo.getDetail(id).status).toBe('draft');
    // incomplete 来自分析结果,但数据库列由 createDraft 写入,这里也应跳过。
    expect(repo.getDetail(incomplete).status).toBe('draft');
  });

  it('does not touch other papers or already confirmed mistakes', () => {
    const otherPaper = papers.create({
      title: '别的卷',
      analysisKey: 'k2',
      grade: 3,
      semester: 1,
      curriculumId: 'pep_primary_math',
      pages: [{ imagePath: '/b.jpg', imageHash: 'h2' }],
    });
    const other = draft({}, otherPaper);
    draft();
    repo.confirmAllInPaper(paperId);
    expect(repo.getDetail(other).status).toBe('draft');
    expect(repo.confirmAllInPaper(paperId)).toEqual({
      confirmed: 0,
      skipped: 0,
    });
  });
});

describe('MistakeRepo.list', () => {
  it('filters by pending/confirmed and by paper', () => {
    const a = draft();
    draft();
    repo.confirm(confirmInput(a));
    expect(repo.list({ status: 'confirmed' })).toHaveLength(1);
    expect(repo.list({ status: 'pending' })).toHaveLength(1);
    expect(repo.list({ paperId })).toHaveLength(2);
    expect(repo.list({ paperId: 'nope' })).toHaveLength(0);
  });

  it('flags incomplete and risky pending questions, never confirmed ones', () => {
    const risky = draft({ warnings: ['归因把握不高,请家长仔细核对'] });
    const gap = draft({ incomplete: true });
    const done = draft({ warnings: ['x'] });
    repo.confirm(confirmInput(done));
    const byId = new Map(repo.list({}).map((m) => [m.id, m]));
    expect(byId.get(risky)?.needsAttention).toBe(true);
    expect(byId.get(gap)?.incomplete).toBe(true);
    expect(byId.get(done)?.needsAttention).toBe(false);
  });

  it('treats the old unattributed status as pending', () => {
    const id = draft();
    repo.db
      .prepare("UPDATE mistakes SET status = 'unattributed' WHERE id = ?")
      .run(id);
    expect(repo.list({ status: 'pending' })).toHaveLength(1);
    expect(papers.list({ grade: 3, semester: 1 }, true)[0].pendingCount).toBe(
      1,
    );
  });
});

describe('PaperRepo.list', () => {
  it('counts pending mistakes per paper and scopes to the current term', () => {
    const a = draft();
    draft();
    repo.confirm(confirmInput(a));
    const [p] = papers.list({ grade: 3, semester: 1 }, false);
    expect(p).toMatchObject({ pendingCount: 1, totalCount: 2 });

    papers.create({
      title: '去年的卷',
      analysisKey: 'old',
      grade: 2,
      semester: 2,
      curriculumId: 'pep_primary_math',
      pages: [{ imagePath: '/o.jpg', imageHash: 'o' }],
    });
    expect(papers.list({ grade: 3, semester: 1 }, false)).toHaveLength(1);
    expect(papers.list({ grade: 3, semester: 1 }, true)).toHaveLength(2);
    // 升学后:三年级下学期看不到三年级上学期的卷子,但“全部”里还在。
    expect(papers.list({ grade: 3, semester: 2 }, false)).toHaveLength(0);
  });

  it('renames a paper and rejects an unknown id', () => {
    papers.rename(paperId, '新名字');
    expect(papers.get(paperId).title).toBe('新名字');
    expect(() => papers.rename('nope', 'x')).toThrow(/找不到/);
  });
});
