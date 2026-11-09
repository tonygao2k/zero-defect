import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_QUESTIONS_PER_ANALYSIS,
  parseBatchAnalysis,
} from '../../shared/analysis';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { openDatabase } from '../db/open';
import { ImageStore } from '../images';
import { MistakeRepo } from '../mistakes';
import { AnalysisService } from './analysis-service';

const question = (over: Record<string, unknown> = {}) => ({
  label: '第1题',
  question_markdown: '计算 $23 \\times 14$',
  student_answer: '312',
  student_work_markdown: '23×4=92',
  correct_answer: '322',
  knowledge_point_code: 'mul_two_digit',
  has_student_work: true,
  root_causes: [
    { code: 'carry_omission', confidence: 0.85, evidence: '漏了进位' },
  ],
  recommended_root_cause: 'carry_omission',
  ...over,
});
const batch = (questions: unknown[], image_quality = 'ok') =>
  JSON.stringify({ image_quality, questions });

describe('parseBatchAnalysis', () => {
  it('parses the batch format and fills image_quality on each question', () => {
    const out = parseBatchAnalysis({
      image_quality: 'blurry',
      questions: [question(), question()],
    });
    expect(out?.questions).toHaveLength(2);
    expect(out?.questions[0].image_quality).toBe('blurry');
  });

  it('accepts the old single-question shape', () => {
    const out = parseBatchAnalysis({ ...question(), image_quality: 'ok' });
    expect(out?.questions).toHaveLength(1);
    expect(out?.questions[0].question_markdown).toContain('23');
  });

  it('keeps an empty list (nothing matched) but rejects unusable output', () => {
    expect(
      parseBatchAnalysis({ image_quality: 'ok', questions: [] })?.questions,
    ).toEqual([]);
    expect(parseBatchAnalysis(null)).toBeNull();
    expect(parseBatchAnalysis('text')).toBeNull();
    expect(parseBatchAnalysis({ hello: 1 })).toBeNull();
    expect(parseBatchAnalysis({ questions: [42, 'x'] })).toBeNull();
  });

  it('drops malformed items but keeps the good ones', () => {
    const out = parseBatchAnalysis({
      questions: [question(), 7, question({ label: '第2题' })],
    });
    expect(out?.questions.map((q) => q.label)).toEqual(['第1题', '第2题']);
  });
});

describe('AnalysisService with several questions', () => {
  let root: string;
  let repo: MistakeRepo;
  let images: ImageStore;
  let n = 0;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-batch-'));
    repo = new MistakeRepo(openDatabase(':memory:'));
    images = new ImageStore(
      path.join(root, 'tmp'),
      path.join(root, 'images'),
      (b) => b,
    );
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const svc = (reply: string | string[]) => {
    const chatFn = vi.fn();
    for (const r of Array.isArray(reply) ? reply : [reply])
      chatFn.mockResolvedValueOnce(r);
    chatFn.mockResolvedValue(
      Array.isArray(reply) ? reply[reply.length - 1] : reply,
    );
    return {
      chatFn,
      service: new AnalysisService({
        repo,
        images,
        getApiKey: () => 'sk-or-test',
        getSettings: () => DEFAULT_SETTINGS,
        chatFn: chatFn as never,
      }),
    };
  };
  const photo = () => images.import(Buffer.from(`sheet-${n++}`)).imageId;

  it('creates one draft per question, all sharing a single image file', async () => {
    const { service } = svc(
      batch([
        question(),
        question({ label: '第3题' }),
        question({ label: '第5题' }),
      ]),
    );
    const out = await service.analyze(photo(), '请识别第 1、3、5 题');
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.mistakes.map((m) => m.analysis.label)).toEqual([
      '第1题',
      '第3题',
      '第5题',
    ]);
    expect(out.skipped).toBe(0);
    expect(repo.list('draft')).toHaveLength(3);
    expect(fs.readdirSync(path.join(root, 'images'))).toHaveLength(1);
    expect(
      repo.db
        .prepare('SELECT COUNT(DISTINCT analysis_key) AS n FROM mistakes')
        .get(),
    ).toEqual({ n: 1 });
  });

  it('skips incomplete questions and reports how many', async () => {
    const { service } = svc(
      batch([
        question(),
        question({ question_markdown: '   ', label: '第2题' }),
      ]),
    );
    const out = await service.analyze(photo());
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.mistakes).toHaveLength(1);
    expect(out.skipped).toBe(1);
  });

  it('fails clearly when every question is unusable, and writes nothing', async () => {
    const { service } = svc(batch([question({ question_markdown: '' })]));
    await expect(service.analyze(photo())).rejects.toThrow(/看不清|不完整/);
    expect(repo.list()).toHaveLength(0);
    expect(fs.readdirSync(path.join(root, 'images'))).toHaveLength(0);
  });

  it('explains when nothing matched the instruction', async () => {
    const { service } = svc(batch([]));
    await expect(service.analyze(photo(), '请识别第 9 题')).rejects.toThrow(
      /没有找到符合的题目/,
    );
    expect(repo.list()).toHaveLength(0);
  });

  it('reports an unreadable photo when there are no questions and quality is unreadable', async () => {
    const { service } = svc(batch([], 'unreadable'));
    await expect(service.analyze(photo())).rejects.toThrow(/看不清/);
  });

  it('caps the number of questions per analysis', async () => {
    const many = Array.from(
      { length: MAX_QUESTIONS_PER_ANALYSIS + 3 },
      (_, i) => question({ label: `第${i + 1}题` }),
    );
    const { service } = svc(batch(many));
    const out = await service.analyze(photo());
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.mistakes).toHaveLength(MAX_QUESTIONS_PER_ANALYSIS);
    expect(out.skipped).toBe(3);
  });

  it('retries once when the reply is not valid JSON, then succeeds', async () => {
    const { service, chatFn } = svc(['不好意思,我没看清', batch([question()])]);
    const out = await service.analyze(photo());
    expect(out.kind).toBe('ok');
    expect(chatFn).toHaveBeenCalledTimes(2);
  });

  it('reports a duplicate with the unconfirmed ids and does not call the model again', async () => {
    const { service, chatFn } = svc(
      batch([question(), question({ label: '第2题' })]),
    );
    const first = await service.analyze(photo(), '所有错题');
    if (first.kind !== 'ok') throw new Error('expected ok');
    repo.confirm({
      mistakeId: first.mistakes[0].mistakeId,
      questionMarkdown: 'q',
      studentAnswer: '',
      studentWorkMarkdown: '',
      correctAnswer: '',
      knowledgePointCode: 'mul_two_digit',
      rootCauseCode: 'carry_omission',
    });

    const sameSheet = images.import(Buffer.from(`sheet-${n - 1}`)).imageId;
    const again = await service.analyze(sameSheet, '所有错题');
    if (again.kind !== 'duplicate') throw new Error('expected duplicate');
    expect(again.mistakeIds).toHaveLength(2);
    expect(again.pendingIds).toEqual([first.mistakes[1].mistakeId]);
    expect(chatFn).toHaveBeenCalledTimes(1);
  });

  it('keeps the shared image until the last draft of the batch is discarded', async () => {
    const { service } = svc(batch([question(), question({ label: '第2题' })]));
    const out = await service.analyze(photo());
    if (out.kind !== 'ok') throw new Error('expected ok');
    const [a, b] = out.mistakes.map((m) => m.mistakeId);

    expect(repo.discardDraft(a)).toBeNull(); // 另一道题还在用这张图
    expect(fs.readdirSync(path.join(root, 'images'))).toHaveLength(1);

    const last = repo.discardDraft(b);
    expect(last).not.toBeNull();
    images.removeStored(last);
    expect(fs.readdirSync(path.join(root, 'images'))).toHaveLength(0);
  });
});
