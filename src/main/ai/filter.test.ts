import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_QUESTIONS_PER_ANALYSIS } from '../../shared/analysis';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { openDatabase } from '../db/open';
import { ImageStore } from '../images';
import { MistakeRepo } from '../mistakes';
import { isAnsweredCorrectly, normalizeAnswer } from './answers';
import { AnalysisError, AnalysisService } from './analysis-service';

describe('normalizeAnswer / isAnsweredCorrectly', () => {
  it('treats every remainder notation as the same answer', () => {
    const forms = [
      '4\\cdots\\cdots1',
      '4...1',
      '4……1',
      '4…1',
      '4余1',
      ' 4 ... 1 ',
      '$4\\cdots1$',
    ];
    const set = new Set(forms.map(normalizeAnswer));
    expect(set.size).toBe(1);
  });

  it('handles full-width characters, spaces, dollar signs and thousands separators', () => {
    expect(normalizeAnswer(' ５６ ')).toBe('56');
    expect(normalizeAnswer('$56$')).toBe('56');
    expect(normalizeAnswer('1,000')).toBe('1000');
    expect(normalizeAnswer(null)).toBe('');
  });

  it('does not merge different numbers', () => {
    expect(isAnsweredCorrectly('7', '9')).toBe(false);
    expect(isAnsweredCorrectly('8...5', '9...1')).toBe(false);
    expect(isAnsweredCorrectly('854', '754')).toBe(false);
  });

  it('is true only when both sides are present and equal', () => {
    expect(isAnsweredCorrectly('56', '56')).toBe(true);
    expect(isAnsweredCorrectly('', '56')).toBe(false);
    expect(isAnsweredCorrectly('56', '')).toBe(false);
    expect(isAnsweredCorrectly(null, null)).toBe(false);
  });
});

const q = (student: string, correct: string, label: string) => ({
  label,
  question_markdown: `题 ${label}`,
  student_answer: student,
  student_work_markdown: '',
  correct_answer: correct,
  knowledge_point_code: 'mul_table',
  has_student_work: false,
  root_causes: [{ code: 'calculation_error', confidence: 0.4, evidence: 'x' }],
  recommended_root_cause: 'calculation_error',
});
const rightOnes = (n: number) =>
  Array.from({ length: n }, (_, i) => q('5', '5', `对${i + 1}`));
const wrongOnes = (n: number) =>
  Array.from({ length: n }, (_, i) => q('7', '9', `错${i + 1}`));
const reply = (questions: unknown[]) =>
  JSON.stringify({ image_quality: 'ok', questions });

describe('AnalysisService drops correctly answered questions', () => {
  let root: string;
  let repo: MistakeRepo;
  let images: ImageStore;
  let n = 0;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-filter-'));
    repo = new MistakeRepo(openDatabase(':memory:'));
    images = new ImageStore(
      path.join(root, 'tmp'),
      path.join(root, 'images'),
      (b) => b,
    );
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const service = (text: string) =>
    new AnalysisService({
      repo,
      images,
      getApiKey: () => 'sk-test',
      getSettings: () => DEFAULT_SETTINGS,
      chatFn: vi.fn().mockResolvedValue(text) as never,
    });
  const photo = () => images.import(Buffer.from(`p-${n++}`)).imageId;

  it('keeps only the wrong ones even when correct ones come first (the real-world bug)', async () => {
    const out = await service(
      reply([...rightOnes(12), ...wrongOnes(3)]),
    ).analyze(photo(), '请识别所有错题');
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.mistakes.map((m) => m.analysis.label)).toEqual([
      '错1',
      '错2',
      '错3',
    ]);
    expect(out.ignoredCorrect).toBe(12);
    expect(out.skipped).toBe(0);
    expect(repo.list('draft')).toHaveLength(3);
  });

  it('applies the cap only to wrong questions', async () => {
    const out = await service(
      reply([...rightOnes(15), ...wrongOnes(MAX_QUESTIONS_PER_ANALYSIS + 2)]),
    ).analyze(photo());
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.mistakes).toHaveLength(MAX_QUESTIONS_PER_ANALYSIS);
    expect(out.skipped).toBe(2);
    expect(out.ignoredCorrect).toBe(15);
  });

  it('ignores answers that only differ in notation', async () => {
    const same = q('4\\cdots\\cdots1', '4...1', '33÷8');
    const out = await service(reply([same, ...wrongOnes(1)])).analyze(photo());
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.mistakes).toHaveLength(1);
    expect(out.ignoredCorrect).toBe(1);
  });

  it('keeps a question with no student answer, since it may be unanswered', async () => {
    const out = await service(reply([q('', '9', '没写答案')])).analyze(photo());
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.mistakes).toHaveLength(1);
    expect(out.ignoredCorrect).toBe(0);
  });

  it('explains when nothing was wrong, and writes nothing', async () => {
    const error = await service(reply(rightOnes(5)))
      .analyze(photo())
      .catch((e) => e);
    expect(error).toBeInstanceOf(AnalysisError);
    expect(error.message).toContain('核对了 5 道题');
    expect(error.message).toContain('没有发现做错的');
    expect(repo.list()).toHaveLength(0);
    expect(fs.readdirSync(path.join(root, 'images'))).toHaveLength(0);
  });
});
