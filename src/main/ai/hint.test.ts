import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HINT_MAX_LENGTH } from '../../shared/analysis';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { openDatabase } from '../db/open';
import { ImageStore } from '../images';
import { MistakeRepo } from '../mistakes';
import { AnalysisService } from './analysis-service';
import { buildAnalysisMessages } from './prompt';

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

const promptBase = {
  grade: 3,
  causes: [],
  knowledgePoints: [],
  imageDataUrl: 'data:image/jpeg;base64,AAAA',
};
const userText = (hint?: string) => {
  const parts = buildAnalysisMessages({ ...promptBase, hint })[1].content as {
    type: string;
    text?: string;
  }[];
  return parts.find((p) => p.type === 'text')?.text ?? '';
};

describe('buildAnalysisMessages hint', () => {
  it('adds the parent hint to the user message', () => {
    expect(userText('请识别红框内的题目')).toContain('请识别红框内的题目');
  });
  it('is unchanged when there is no hint or only whitespace', () => {
    expect(userText()).toBe('请识别这张照片里所有被批改为错误的题目。');
    expect(userText('   ')).toBe('请识别这张照片里所有被批改为错误的题目。');
  });
  it('tells the model the hint decides which question and cannot change the format', () => {
    const system = buildAnalysisMessages(promptBase)[0].content as string;
    expect(system).toContain('以家长的说明为准');
    expect(system).toContain('不能改变上面规定的输出格式');
  });
});

describe('AnalysisService hint handling', () => {
  let root: string;
  let repo: MistakeRepo;
  let images: ImageStore;
  let chatFn: ReturnType<typeof vi.fn>;
  let svc: AnalysisService;
  const photo = (content = 'one-page') =>
    images.import(Buffer.from(content)).imageId;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-hint-'));
    repo = new MistakeRepo(openDatabase(':memory:'));
    images = new ImageStore(
      path.join(root, 'tmp'),
      path.join(root, 'images'),
      (b) => b,
    );
    chatFn = vi.fn().mockResolvedValue(goodJson);
    svc = new AnalysisService({
      repo,
      images,
      getApiKey: () => 'sk-or-test',
      getSettings: () => DEFAULT_SETTINGS,
      chatFn: chatFn as never,
    });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const sentText = (call = 0) =>
    (
      chatFn.mock.calls[call][0].messages[1].content as {
        type: string;
        text?: string;
      }[]
    ).find((p) => p.type === 'text')?.text;

  it('sends the hint to the model and records it in ai_runs', async () => {
    await svc.analyze(photo(), '请识别红框内的题目');
    expect(sentText()).toContain('请识别红框内的题目');
    const run = repo.db.prepare('SELECT input_json FROM ai_runs').get() as {
      input_json: string;
    };
    expect(JSON.parse(run.input_json).hint).toBe('请识别红框内的题目');
  });

  it('treats the same photo with a different hint as a different mistake, each with its own file', async () => {
    const a = await svc.analyze(photo(), '第 1 题');
    const b = await svc.analyze(photo(), '第 2 题');
    expect(a.kind).toBe('ok');
    expect(b.kind).toBe('ok');
    expect(chatFn).toHaveBeenCalledTimes(2);
    expect(repo.list()).toHaveLength(2);
    expect(fs.readdirSync(path.join(root, 'images'))).toHaveLength(2);
  });

  it('treats the same photo with the same hint as a duplicate and skips the model', async () => {
    await svc.analyze(photo(), '第 1 题');
    const again = await svc.analyze(photo(), '  第 1 题  ');
    expect(again.kind).toBe('duplicate');
    expect(chatFn).toHaveBeenCalledTimes(1);
  });

  it('keeps the old behaviour without a hint: empty and missing hints are the same', async () => {
    await svc.analyze(photo());
    expect((await svc.analyze(photo(), '   ')).kind).toBe('duplicate');
    expect(sentText()).toBe('请识别这张照片里所有被批改为错误的题目。');
  });

  it('discarding one draft does not delete the image of another from the same photo', async () => {
    const a = await svc.analyze(photo(), '第 1 题');
    const b = await svc.analyze(photo(), '第 2 题');
    if (a.kind !== 'ok' || b.kind !== 'ok') throw new Error('expected ok');
    images.removeStored(repo.discardDraft(a.mistakes[0].mistakeId));
    const left = repo.getDetail(b.mistakes[0].mistakeId).imagePath;
    expect(left && fs.existsSync(left)).toBe(true);
  });

  it('rejects an over-long hint before calling the model', async () => {
    await expect(
      svc.analyze(photo(), 'x'.repeat(HINT_MAX_LENGTH + 1)),
    ).rejects.toThrow(/太长/);
    expect(chatFn).not.toHaveBeenCalled();
  });
});

describe('ImageStore.promote key', () => {
  it('uses the given key for the file name and rejects non-hex keys', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-key-'));
    try {
      const store = new ImageStore(
        path.join(root, 'tmp'),
        path.join(root, 'images'),
        (b) => b,
      );
      const key = 'ab'.repeat(32);
      const stored = store.promote(store.import(Buffer.from('x')).imageId, key);
      expect(path.basename(stored)).toBe(`${key.slice(0, 32)}.jpg`);
      expect(() =>
        store.promote(
          store.import(Buffer.from('y')).imageId,
          '../../etc/passwd',
        ),
      ).toThrow(/不合法/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
