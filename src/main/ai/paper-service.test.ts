import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseBatchAnalysis } from '../../shared/analysis';
import { MAX_PAGES_PER_PAPER } from '../../shared/papers';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { openDatabase } from '../db/open';
import { ImageStore } from '../images';
import { MistakeRepo } from '../mistakes';
import { PaperRepo } from '../papers';
import { LlmError } from './llm-client';
import { PaperService } from './paper-service';

const wrongQ = (over: Record<string, unknown> = {}) => ({
  label: '第3题',
  pages: [1],
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
const reply = (questions: unknown[], quality = 'ok') =>
  JSON.stringify({ image_quality: quality, questions });

let root: string;
let repo: MistakeRepo;
let papers: PaperRepo;
let images: ImageStore;
let n = 0;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'zd-paper-'));
  const db = openDatabase(':memory:');
  repo = new MistakeRepo(db);
  papers = new PaperRepo(db);
  images = new ImageStore(
    path.join(root, 'tmp'),
    path.join(root, 'images'),
    (b) => b,
  );
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const service = (
  chatFn: ReturnType<typeof vi.fn>,
  apiKey: string | null = 'sk-test',
) =>
  new PaperService({
    papers,
    repo,
    images,
    getApiKey: () => apiKey,
    getSettings: () => DEFAULT_SETTINGS,
    chatFn: chatFn as never,
  });
const newImage = () => images.import(Buffer.from(`image-${n++}`)).imageId;
const newImages = (count: number) =>
  Array.from({ length: count }, () => newImage());

const submit = async (
  svc: PaperService,
  ids: string[],
  title = '三年级下期末卷',
) => {
  const out = svc.submit({ imageIds: ids, title });
  await svc.idle();
  return out;
};

describe('parseBatchAnalysis', () => {
  it('parses the batch format and fills image_quality on each question', () => {
    const b = parseBatchAnalysis(
      JSON.parse(reply([wrongQ(), wrongQ()], 'blurry')),
    );
    expect(b?.questions).toHaveLength(2);
    expect(b?.questions[0].image_quality).toBe('blurry');
  });

  it('keeps an empty list but rejects unusable output', () => {
    expect(parseBatchAnalysis({ questions: [] })?.questions).toEqual([]);
    expect(parseBatchAnalysis('x')).toBeNull();
    expect(parseBatchAnalysis({ foo: 1 })).toBeNull();
  });

  it('drops malformed items but keeps the good ones', () => {
    const b = parseBatchAnalysis({ questions: [wrongQ(), 5, null] });
    expect(b?.questions).toHaveLength(1);
  });
});

describe('PaperService.submit', () => {
  it('creates a paper with ordered pages, drafts linked to pages, and logs usage', async () => {
    const chatFn = vi.fn(async (opts: { onUsage?: (u: unknown) => void }) => {
      opts.onUsage?.({ promptTokens: 1000, completionTokens: 200 });
      return reply([
        wrongQ({ pages: [1] }),
        wrongQ({ pages: [2], label: '第9题' }),
      ]);
    });
    const svc = service(chatFn as never);
    const out = await submit(svc, newImages(2));
    if (out.kind !== 'started') throw new Error('expected started');

    const paper = papers.get(out.paperId);
    expect(paper).toMatchObject({
      title: '三年级下期末卷',
      status: 'done',
      grade: 3,
    });
    const pages = papers.pages(out.paperId);
    expect(pages.map((p) => p.position)).toEqual([0, 1]);
    for (const p of pages) expect(fs.existsSync(p.imagePath)).toBe(true);
    expect(fs.readdirSync(path.join(root, 'tmp'))).toHaveLength(0);

    const list = repo.list({ paperId: out.paperId });
    expect(list).toHaveLength(2);
    const pagesOf = (id: string) =>
      repo
        .getDetail(id)
        .imagePaths.map((p) => pages.findIndex((x) => x.imagePath === p));
    expect(pagesOf(list[0].id)).toEqual([0]);
    expect(pagesOf(list[1].id)).toEqual([1]);

    // 所有题都是待确认
    expect(list.every((m) => m.status === 'draft')).toBe(true);

    const run = repo.db
      .prepare('SELECT status, input_json FROM ai_runs')
      .get() as { status: string; input_json: string };
    expect(run.status).toBe('ok');
    expect(run.input_json).not.toContain('base64');
    expect(JSON.parse(run.input_json).usage).toEqual({
      promptTokens: 1000,
      completionTokens: 200,
    });
  });

  it('sends every page to the model in order', async () => {
    const chatFn = vi.fn().mockResolvedValue(reply([wrongQ()]));
    await submit(service(chatFn), newImages(3));
    const content = chatFn.mock.calls[0][0].messages[1].content as {
      type: string;
    }[];
    expect(content.filter((p) => p.type === 'image_url')).toHaveLength(3);
  });

  it('links a question to all pages when the model does not say where it is', async () => {
    const svc = service(
      vi.fn().mockResolvedValue(reply([wrongQ({ pages: undefined })])),
    );
    const out = await submit(svc, newImages(2));
    if (out.kind !== 'started') throw new Error();
    const [m] = repo.list({ paperId: out.paperId });
    expect(repo.getDetail(m.id).imagePaths).toHaveLength(2);
  });

  it('merges a cross-page question: it spans both pages and is flagged incomplete', async () => {
    const svc = service(
      vi
        .fn()
        .mockResolvedValue(
          reply([wrongQ({ pages: [1, 2], incomplete: true })]),
        ),
    );
    const out = await submit(svc, newImages(2));
    if (out.kind !== 'started') throw new Error();
    const [m] = repo.list({ paperId: out.paperId });
    expect(m.incomplete).toBe(true);
    expect(repo.getDetail(m.id).imagePaths).toHaveLength(2);
  });

  it('records unanswered questions with the not_attempted cause', async () => {
    const svc = service(
      vi.fn().mockResolvedValue(
        reply([
          wrongQ({
            student_answer: '',
            student_work_markdown: '',
            has_student_work: false,
            root_causes: [],
            recommended_root_cause: null,
          }),
        ]),
      ),
    );
    const out = await submit(svc, newImages(1));
    if (out.kind !== 'started') throw new Error();
    const [m] = repo.list({ paperId: out.paperId });
    expect(repo.getDetail(m.id).analysis?.recommendedRootCause).toBe(
      'not_attempted',
    );
  });

  it('drops questions the child actually got right, before applying the cap', async () => {
    const rights = Array.from({ length: 40 }, (_, i) =>
      wrongQ({ label: `对${i}`, student_answer: '322', correct_answer: '322' }),
    );
    const svc = service(
      vi.fn().mockResolvedValue(reply([...rights, wrongQ({ label: '错的' })])),
    );
    const out = await submit(svc, newImages(1));
    if (out.kind !== 'started') throw new Error();
    expect(repo.list({ paperId: out.paperId })).toHaveLength(1);
  });

  it('finishes with zero mistakes when nothing is wrong', async () => {
    const svc = service(vi.fn().mockResolvedValue(reply([])));
    const out = await submit(svc, newImages(1));
    if (out.kind !== 'started') throw new Error();
    expect(papers.get(out.paperId).status).toBe('done');
    expect(repo.list({ paperId: out.paperId })).toHaveLength(0);
  });

  it('is a duplicate when the same images come in the same order, without calling the model', async () => {
    const chatFn = vi.fn().mockResolvedValue(reply([wrongQ()]));
    const svc = service(chatFn);
    const first = await submit(svc, [
      images.import(Buffer.from('A')).imageId,
      images.import(Buffer.from('B')).imageId,
    ]);
    const again = await submit(svc, [
      images.import(Buffer.from('A')).imageId,
      images.import(Buffer.from('B')).imageId,
    ]);
    expect(again.kind).toBe('duplicate');
    if (first.kind === 'started' && again.kind === 'duplicate')
      expect(again.paperId).toBe(first.paperId);
    expect(chatFn).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(path.join(root, 'tmp'))).toHaveLength(0);
  });

  it('treats a different page order as a different paper', async () => {
    const chatFn = vi.fn().mockResolvedValue(reply([wrongQ()]));
    const svc = service(chatFn);
    await submit(svc, [
      images.import(Buffer.from('A')).imageId,
      images.import(Buffer.from('B')).imageId,
    ]);
    const swapped = await submit(svc, [
      images.import(Buffer.from('B')).imageId,
      images.import(Buffer.from('A')).imageId,
    ]);
    expect(swapped.kind).toBe('started');
  });

  it('falls back to a time-based title when the name is blank', async () => {
    const out = await submit(
      service(vi.fn().mockResolvedValue(reply([]))),
      newImages(1),
      '   ',
    );
    if (out.kind !== 'started') throw new Error();
    expect(papers.get(out.paperId).title).toMatch(
      /^\d{4}年\d{1,2}月\d{1,2}日 \d{1,2}时$/,
    );
  });

  it('rejects too many pages, no pages, and a missing key before doing anything', () => {
    const chatFn = vi.fn();
    expect(() =>
      service(chatFn).submit({
        imageIds: newImages(MAX_PAGES_PER_PAPER + 1),
        title: '',
      }),
    ).toThrow(/最多 6 页/);
    expect(() => service(chatFn).submit({ imageIds: [], title: '' })).toThrow(
      /添加试卷图片/,
    );
    expect(() =>
      service(chatFn, null).submit({ imageIds: newImages(1), title: '' }),
    ).toThrow(/API Key/);
    expect(chatFn).not.toHaveBeenCalled();
    expect(papers.list({ grade: 3, semester: 1 }, true)).toHaveLength(0);
  });
});

describe('failures and retry', () => {
  it('marks the paper failed with a readable message, keeps its images, and logs the run', async () => {
    const svc = service(
      vi.fn().mockRejectedValue(new LlmError('auth', 'Key 不对')),
    );
    const out = await submit(svc, newImages(1));
    if (out.kind !== 'started') throw new Error();
    expect(papers.get(out.paperId)).toMatchObject({
      status: 'failed',
      errorMessage: 'Key 不对',
    });
    expect(fs.existsSync(papers.pages(out.paperId)[0].imagePath)).toBe(true);
    expect(repo.db.prepare('SELECT status FROM ai_runs').get()).toEqual({
      status: 'failed',
    });
  });

  it('retries once on unparseable output, then fails clearly', async () => {
    const chatFn = vi.fn().mockResolvedValue('not json');
    const out = await submit(service(chatFn), newImages(1));
    if (out.kind !== 'started') throw new Error();
    expect(chatFn).toHaveBeenCalledTimes(2);
    expect(papers.get(out.paperId).errorMessage).toMatch(/无法解析/);
  });

  it('reports an unreadable photo', async () => {
    const out = await submit(
      service(vi.fn().mockResolvedValue(reply([], 'unreadable'))),
      newImages(1),
    );
    if (out.kind !== 'started') throw new Error();
    expect(papers.get(out.paperId)).toMatchObject({ status: 'failed' });
    expect(papers.get(out.paperId).errorMessage).toMatch(/看不清/);
  });

  it('retry reuses the stored images and succeeds', async () => {
    const chatFn = vi
      .fn()
      .mockRejectedValueOnce(new LlmError('network', '网络不通'))
      .mockResolvedValueOnce(reply([wrongQ()]));
    const svc = service(chatFn);
    const out = await submit(svc, newImages(2));
    if (out.kind !== 'started') throw new Error();
    expect(papers.get(out.paperId).status).toBe('failed');

    svc.retry(out.paperId);
    expect(papers.get(out.paperId).status).toBe('processing');
    await svc.idle();
    expect(papers.get(out.paperId)).toMatchObject({
      status: 'done',
      errorMessage: null,
    });
    expect(repo.list({ paperId: out.paperId })).toHaveLength(1);
  });

  it('only failed papers can be retried', async () => {
    const svc = service(vi.fn().mockResolvedValue(reply([wrongQ()])));
    const out = await submit(svc, newImages(1));
    if (out.kind !== 'started') throw new Error();
    expect(() => svc.retry(out.paperId)).toThrow(/不需要重试/);
  });

  it('submitting the same images again after a failure starts over instead of reporting a duplicate', async () => {
    const chatFn = vi
      .fn()
      .mockRejectedValueOnce(new LlmError('server', '服务出错'))
      .mockResolvedValueOnce(reply([wrongQ()]));
    const svc = service(chatFn);
    const first = await submit(svc, [images.import(Buffer.from('X')).imageId]);
    const second = await submit(svc, [images.import(Buffer.from('X')).imageId]);
    expect(first.kind).toBe('started');
    expect(second.kind).toBe('started');
    expect(papers.list({ grade: 3, semester: 1 }, true)).toHaveLength(1);
    expect(fs.readdirSync(path.join(root, 'images'))).toHaveLength(1);
  });

  it('recovers papers left in processing by an earlier crash', () => {
    const id = papers.create({
      title: 't',
      analysisKey: 'k',
      grade: 3,
      semester: 1,
      curriculumId: 'pep_primary_math',
      pages: [{ imagePath: '/x.jpg', imageHash: 'h' }],
    });
    service(vi.fn()).recoverInterrupted();
    expect(papers.get(id)).toMatchObject({ status: 'failed' });
    expect(papers.get(id).errorMessage).toMatch(/中断/);
  });
});

describe('deleting', () => {
  it('deleting a paper removes its mistakes, pages and image files', async () => {
    const svc = service(vi.fn().mockResolvedValue(reply([wrongQ(), wrongQ()])));
    const out = await submit(svc, newImages(2));
    if (out.kind !== 'started') throw new Error();
    svc.deletePaper(out.paperId);
    expect(repo.list({})).toHaveLength(0);
    expect(papers.list({ grade: 3, semester: 1 }, true)).toHaveLength(0);
    expect(fs.readdirSync(path.join(root, 'images'))).toHaveLength(0);
  });

  it('deleting one mistake keeps the paper and its images', async () => {
    const svc = service(vi.fn().mockResolvedValue(reply([wrongQ(), wrongQ()])));
    const out = await submit(svc, newImages(1));
    if (out.kind !== 'started') throw new Error();
    const [a] = repo.list({ paperId: out.paperId });
    repo.delete(a.id);
    expect(repo.list({ paperId: out.paperId })).toHaveLength(1);
    expect(fs.readdirSync(path.join(root, 'images'))).toHaveLength(1);
  });
});
