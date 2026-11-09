import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../db/open';
import { ImageStore } from '../images';
import { MistakeRepo } from '../mistakes';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { AnalysisError, AnalysisService } from './analysis-service';
import { LlmError } from './llm-client';

const goodJson = JSON.stringify({
  question_markdown: '计算 $23 \\times 14$',
  student_answer: '312',
  student_work_markdown: '23×4=92',
  correct_answer: '322',
  knowledge_point_code: 'mul_two_digit',
  has_student_work: true,
  image_quality: 'ok',
  root_causes: [
    { code: 'carry_omission', confidence: 0.85, evidence: '漏了进位' },
  ],
  recommended_root_cause: 'carry_omission',
});

let root: string;
let repo: MistakeRepo;
let images: ImageStore;
let n = 0;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-svc-'));
  repo = new MistakeRepo(openDatabase(':memory:'));
  images = new ImageStore(
    path.join(root, 'tmp'),
    path.join(root, 'images'),
    (b) => b,
  );
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const service = (
  chatFn: ReturnType<typeof vi.fn>,
  apiKey: string | null = 'sk-or-test',
) =>
  new AnalysisService({
    repo,
    images,
    getApiKey: () => apiKey,
    getSettings: () => DEFAULT_SETTINGS,
    chatFn: chatFn as never,
  });
const newImage = () => images.import(Buffer.from(`image-${n++}`)).imageId;

describe('AnalysisService.analyze', () => {
  it('saves a draft with candidates, moves the image, and logs the run', async () => {
    const out = await service(vi.fn().mockResolvedValue(goodJson)).analyze(
      newImage(),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.mistakes[0].analysis.recommendedRootCause).toBe(
      'carry_omission',
    );

    const row = repo.db
      .prepare(
        'SELECT status, image_path, knowledge_point_id, grade FROM mistakes WHERE id = ?',
      )
      .get(out.mistakes[0].mistakeId) as Record<string, unknown>;
    expect(row).toMatchObject({
      status: 'draft',
      knowledge_point_id: 'mul_two_digit',
      grade: 3,
    });
    expect(fs.existsSync(row.image_path as string)).toBe(true);
    expect(fs.readdirSync(path.join(root, 'tmp'))).toHaveLength(0);

    const cause = repo.db
      .prepare(
        'SELECT confirmed, is_primary FROM mistake_root_causes WHERE mistake_id = ?',
      )
      .get(out.mistakes[0].mistakeId);
    expect(cause).toEqual({ confirmed: 0, is_primary: 0 });
    const run = repo.db
      .prepare('SELECT status, input_json FROM ai_runs')
      .get() as { status: string; input_json: string };
    expect(run.status).toBe('ok');
    expect(run.input_json).not.toContain('base64');
  });

  it('retries once when the first reply is not valid JSON', async () => {
    const chatFn = vi
      .fn()
      .mockResolvedValueOnce('抱歉,我无法……')
      .mockResolvedValueOnce(goodJson);
    const out = await service(chatFn).analyze(newImage());
    expect(out.kind).toBe('ok');
    expect(chatFn).toHaveBeenCalledTimes(2);
  });

  it('fails cleanly after two unparseable replies: no draft, image stays in temp, run logged', async () => {
    const id = newImage();
    const chatFn = vi.fn().mockResolvedValue('not json');
    await expect(service(chatFn).analyze(id)).rejects.toThrow(/无法解析/);
    expect(chatFn).toHaveBeenCalledTimes(2);
    expect(repo.list()).toHaveLength(0);
    expect(fs.readdirSync(path.join(root, 'images'))).toHaveLength(0);
    expect(images.read(id)).toBeDefined(); // 句柄仍有效,可以直接重试
    expect(repo.db.prepare('SELECT status FROM ai_runs').get()).toEqual({
      status: 'failed',
    });
  });

  it('reports an unreadable image without creating a draft', async () => {
    const bad = JSON.stringify({
      question_markdown: '',
      image_quality: 'unreadable',
    });
    await expect(
      service(vi.fn().mockResolvedValue(bad)).analyze(newImage()),
    ).rejects.toThrow(/看不清/);
    expect(repo.list()).toHaveLength(0);
  });

  it('surfaces provider errors as friendly messages', async () => {
    const chatFn = vi
      .fn()
      .mockRejectedValue(
        new LlmError('auth', 'API Key 无效或没有权限,请在家长入口检查'),
      );
    await expect(service(chatFn).analyze(newImage())).rejects.toThrow(
      /API Key 无效/,
    );
  });

  it('requires an API key before doing anything', async () => {
    const chatFn = vi.fn();
    await expect(
      service(chatFn, null).analyze(newImage()),
    ).rejects.toBeInstanceOf(AnalysisError);
    expect(chatFn).not.toHaveBeenCalled();
  });

  it('detects a duplicate by hash, skips the model call, and drops the temp copy', async () => {
    const chatFn = vi.fn().mockResolvedValue(goodJson);
    const svc = service(chatFn);
    const first = images.import(Buffer.from('same-photo')).imageId;
    const ok = await svc.analyze(first);
    const second = images.import(Buffer.from('same-photo')).imageId;
    const dup = await svc.analyze(second);
    expect(dup).toMatchObject({ kind: 'duplicate' });
    if (ok.kind === 'ok' && dup.kind === 'duplicate')
      expect(dup.mistakeIds).toEqual([ok.mistakes[0].mistakeId]);
    expect(chatFn).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(path.join(root, 'tmp'))).toHaveLength(0);
  });
});

describe('MistakeRepo flows', () => {
  const draft = async () => {
    const out = await service(vi.fn().mockResolvedValue(goodJson)).analyze(
      newImage(),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    return out.mistakes[0].mistakeId;
  };
  const fields = (mistakeId: string) => ({
    mistakeId,
    questionMarkdown: '计算 $23 \\times 14$',
    studentAnswer: '312',
    studentWorkMarkdown: '',
    correctAnswer: '322',
    knowledgePointCode: 'mul_two_digit',
  });

  it('confirm activates the mistake and creates a mastery row with score 1.0', async () => {
    const id = await draft();
    repo.confirm({ ...fields(id), rootCauseCode: 'carry_omission' });
    expect(
      repo.db.prepare('SELECT status FROM mistakes WHERE id = ?').get(id),
    ).toEqual({ status: 'active' });
    expect(
      repo.db
        .prepare(
          'SELECT confirmed, is_primary FROM mistake_root_causes WHERE mistake_id = ?',
        )
        .get(id),
    ).toEqual({ confirmed: 1, is_primary: 1 });
    expect(repo.db.prepare('SELECT score, status FROM mastery').get()).toEqual({
      score: 1,
      status: 'active',
    });
  });

  it('confirm lets the parent pick a cause the model did not suggest', async () => {
    const id = await draft();
    repo.confirm({ ...fields(id), rootCauseCode: 'calculation_error' });
    const primaries = repo.db
      .prepare(
        'SELECT root_cause_id FROM mistake_root_causes WHERE mistake_id = ? AND is_primary = 1',
      )
      .all(id);
    expect(primaries).toEqual([{ root_cause_id: 'calculation_error' }]);
  });

  it('confirm rejects needs_review, unknown causes, and unknown knowledge points', async () => {
    const id = await draft();
    expect(() =>
      repo.confirm({ ...fields(id), rootCauseCode: 'needs_review' }),
    ).toThrow(/具体/);
    expect(() =>
      repo.confirm({ ...fields(id), rootCauseCode: 'nope' }),
    ).toThrow(/不存在/);
    expect(() =>
      repo.confirm({
        ...fields(id),
        rootCauseCode: 'carry_omission',
        knowledgePointCode: 'nope',
      }),
    ).toThrow(/知识点/);
    expect(repo.db.prepare('SELECT COUNT(*) AS n FROM mastery').get()).toEqual({
      n: 0,
    });
    expect(
      repo.db.prepare('SELECT status FROM mistakes WHERE id = ?').get(id),
    ).toEqual({ status: 'draft' });
  });

  it('a repeated mistake resets an existing mastery entry back to active', async () => {
    const id = await draft();
    repo.confirm({ ...fields(id), rootCauseCode: 'carry_omission' });
    repo.db.exec(
      "UPDATE mastery SET score = 0.3, status = 'review', review_level = 2, consecutive_correct = 3, next_review_at = 'x'",
    );
    const id2 = await service(vi.fn().mockResolvedValue(goodJson)).analyze(
      newImage(),
    );
    if (id2.kind !== 'ok') throw new Error('expected ok');
    repo.confirm({
      ...fields(id2.mistakes[0].mistakeId),
      rootCauseCode: 'carry_omission',
    });
    expect(
      repo.db
        .prepare(
          'SELECT score, status, review_level, consecutive_correct, next_review_at FROM mastery',
        )
        .get(),
    ).toEqual({
      score: 1,
      status: 'active',
      review_level: 0,
      consecutive_correct: 0,
      next_review_at: null,
    });
  });

  it('skip keeps the mistake but writes no attribution and creates no mastery', async () => {
    const id = await draft();
    repo.skip(fields(id));
    expect(
      repo.db.prepare('SELECT status FROM mistakes WHERE id = ?').get(id),
    ).toEqual({ status: 'unattributed' });
    expect(
      repo.db.prepare('SELECT COUNT(*) AS n FROM mistake_root_causes').get(),
    ).toEqual({ n: 0 });
    expect(repo.db.prepare('SELECT COUNT(*) AS n FROM mastery').get()).toEqual({
      n: 0,
    });
  });

  it('discard deletes the draft so the same image can be uploaded again', async () => {
    const id = await draft();
    images.removeStored(repo.discardDraft(id));
    expect(repo.list()).toHaveLength(0);
    expect(fs.readdirSync(path.join(root, 'images'))).toHaveLength(0);
    const again = await service(vi.fn().mockResolvedValue(goodJson)).analyze(
      images.import(Buffer.from('image-0')).imageId,
    );
    expect(again.kind).toBe('ok');
  });

  it('only drafts can be discarded; confirmed mistakes are protected', async () => {
    const id = await draft();
    repo.confirm({ ...fields(id), rootCauseCode: 'carry_omission' });
    expect(() => repo.discardDraft(id)).toThrow(/状态/);
  });

  it('lists mistakes newest first with labels, filterable by status', async () => {
    const id = await draft();
    repo.confirm({ ...fields(id), rootCauseCode: 'carry_omission' });
    const [row] = repo.list('active');
    expect(row).toMatchObject({
      knowledgePointLabel: '两位数乘两位数',
      primaryRootCauseLabel: '进位或退位遗漏',
    });
    expect(repo.list('draft')).toHaveLength(0);
  });
});
