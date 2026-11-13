import { describe, expect, it } from 'vitest';
import { RawAnalysisSchema } from '../../shared/analysis';
import { extractJson } from './json';
import {
  UnreadableImageError,
  postprocess,
  type PostprocessContext,
} from './postprocess';

const ctx: PostprocessContext = {
  pageCount: 2,
  activeCauseCodes: new Set([
    'carry_omission',
    'calculation_error',
    'unit_omission',
  ]),
  knowledgePointCodes: new Set(['mul_two_digit', 'perimeter']),
  confidenceThreshold: 0.7,
};

const base = {
  question_markdown: '计算 $23 \\times 14$',
  student_answer: '312',
  student_work_markdown: '23×4=92, 23×1=23, 92+23=115... ',
  correct_answer: '322',
  knowledge_point_code: 'mul_two_digit',
  has_student_work: true,
  image_quality: 'ok',
  root_causes: [
    { code: 'carry_omission', confidence: 0.82, evidence: '漏了进位' },
  ],
  recommended_root_cause: 'carry_omission',
};
const run = (over: Record<string, unknown> = {}, c = ctx) =>
  postprocess(RawAnalysisSchema.parse({ ...base, ...over }), c);

describe('extractJson', () => {
  it('parses plain, fenced, and chatty output', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('好的,结果如下:\n{"a":{"b":2}}\n希望有帮助')).toEqual({
      a: { b: 2 },
    });
  });
  it('returns null for broken or missing JSON', () => {
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('{"a":')).toBeNull();
    expect(extractJson('')).toBeNull();
  });
});

describe('RawAnalysisSchema', () => {
  it('accepts string confidences and null fields', () => {
    const raw = RawAnalysisSchema.parse({
      question_markdown: 'q',
      student_answer: null,
      root_causes: [{ code: 'x', confidence: '0.9', evidence: null }],
    });
    expect(raw.root_causes[0].confidence).toBe(0.9);
    expect(raw.has_student_work).toBe(false);
  });
});

describe('postprocess', () => {
  it('passes a clean result through', () => {
    const r = run();
    expect(r.recommendedRootCause).toBe('carry_omission');
    expect(r.knowledgePointCode).toBe('mul_two_digit');
    expect(r.warnings).toEqual([]);
  });

  it('maps unknown causes to needs_review and never recommends them', () => {
    const r = run({
      root_causes: [{ code: 'made_up_cause', confidence: 0.95, evidence: 'x' }],
      recommended_root_cause: 'made_up_cause',
    });
    expect(r.rootCauses[0]).toMatchObject({
      code: 'needs_review',
      unknownFromModel: true,
    });
    expect(r.recommendedRootCause).toBeNull();
    expect(r.warnings.join()).toContain('不在清单内');
  });

  it('falls back to the best usable candidate when the recommendation is invalid', () => {
    const r = run({
      root_causes: [
        { code: 'made_up', confidence: 0.9 },
        { code: 'calculation_error', confidence: 0.6 },
      ],
      recommended_root_cause: 'made_up',
    });
    expect(r.recommendedRootCause).toBe('calculation_error');
  });

  it('caps confidence at 0.5 without student work and warns', () => {
    const r = run({ has_student_work: false });
    expect(r.rootCauses[0].confidence).toBe(0.5);
    expect(r.warnings.join()).toContain('缺少解题过程');
  });

  it('warns on low confidence', () => {
    const r = run({
      root_causes: [{ code: 'carry_omission', confidence: 0.4 }],
    });
    expect(r.warnings.join()).toContain('把握不高');
  });

  it('dedupes by code keeping the highest, clamps, and sorts', () => {
    const r = run({
      root_causes: [
        { code: 'carry_omission', confidence: 0.3 },
        { code: 'carry_omission', confidence: 5 },
        { code: 'calculation_error', confidence: -1 },
      ],
    });
    expect(r.rootCauses.map((c) => [c.code, c.confidence])).toEqual([
      ['carry_omission', 1],
      ['calculation_error', 0],
    ]);
  });

  it('maps an unknown knowledge point to other', () => {
    const r = run({ knowledge_point_code: 'nonsense' });
    expect(r.knowledgePointCode).toBe('other');
    expect(r.warnings.join()).toContain('知识点');
  });

  it('throws UnreadableImageError for empty question or unreadable quality', () => {
    expect(() => run({ question_markdown: '   ' })).toThrow(
      UnreadableImageError,
    );
    expect(() => run({ image_quality: 'unreadable' })).toThrow(
      UnreadableImageError,
    );
  });

  it('warns on blurry images but still returns a result', () => {
    expect(run({ image_quality: 'blurry' }).warnings.join()).toContain('模糊');
  });
});

describe('postprocess: figure on the original question', () => {
  it('treats a missing figure as none and clears any stray note', () => {
    expect(run()).toMatchObject({ figureKind: 'none', figureNote: '' });
    expect(
      run({ figure_kind: 'none', figure_note: '多余的说明' }),
    ).toMatchObject({ figureKind: 'none', figureNote: '' });
  });

  it('keeps a known figure kind and its note', () => {
    const a = run({
      figure_kind: 'cube_net',
      figure_note: '6 个带字的格子组成的展开图,问哪两个字相对',
    });
    expect(a.figureKind).toBe('cube_net');
    expect(a.figureNote).toContain('展开图');
  });

  it('maps an unrecognised kind to other, and trims long notes', () => {
    const a = run({ figure_kind: '几何图形', figure_note: '长'.repeat(500) });
    expect(a.figureKind).toBe('other');
    expect(a.figureNote).toHaveLength(200);
  });
});
