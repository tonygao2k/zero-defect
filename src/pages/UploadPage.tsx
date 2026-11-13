import { useEffect, useRef, useState } from 'react';
import { Note, Page, Waiting, btn, inputClass } from '../components/ui';
import { PdfError, renderPdfPages } from '../lib/pdf';
import type { ImageHandle } from '../shared/ipc';
import {
  MAX_PAGES_PER_PAPER,
  PAPER_TITLE_MAX_LENGTH,
  defaultPaperTitle,
  type PaperSummary,
} from '../shared/papers';

type Step =
  | { name: 'edit' }
  | { name: 'title' }
  | { name: 'submitting' }
  | { name: 'done'; paperId: string; title: string }
  | { name: 'duplicate'; paperId: string; title: string };

export function UploadPage(props: { onOpenLibrary: () => void }) {
  const [items, setItems] = useState<ImageHandle[]>([]);
  const [step, setStep] = useState<Step>({ name: 'edit' });
  const [title, setTitle] = useState('');
  const [busyText, setBusyText] = useState('');
  const [error, setError] = useState('');
  const dragFrom = useRef<number | null>(null);

  const full = items.length >= MAX_PAGES_PER_PAPER;

  /** 超出页数上限的图片不收,并释放它们占用的临时文件。 */
  const accept = async (added: ImageHandle[]) => {
    const room = MAX_PAGES_PER_PAPER - items.length;
    const kept = added.slice(0, Math.max(room, 0));
    for (const extra of added.slice(kept.length))
      await window.api.discardImage({ imageId: extra.imageId });
    if (added.length > kept.length) {
      setError(
        `一份试卷最多 ${MAX_PAGES_PER_PAPER} 页,多出的图片没有添加,请分次提交`,
      );
    }
    setItems((prev) => [...prev, ...kept]);
  };

  const addFiles = async () => {
    setError('');
    const res = await window.api.pickFiles();
    if (!res.ok) return setError(res.error);
    const handles: ImageHandle[] = [];
    for (const file of res.value) {
      if (file.kind === 'image') {
        handles.push(file.handle);
        continue;
      }
      try {
        const room = MAX_PAGES_PER_PAPER - items.length - handles.length;
        setBusyText(`正在转换 ${file.name}…`);
        const pages = await renderPdfPages(file.bytes, Math.max(room, 0));
        for (const bytes of pages) {
          const imported = await window.api.importImage({ bytes });
          if (!imported.ok) throw new PdfError(imported.error);
          handles.push(imported.value);
        }
      } catch (e) {
        setBusyText('');
        for (const h of handles)
          await window.api.discardImage({ imageId: h.imageId });
        return setError(
          e instanceof PdfError ? e.message : 'PDF 转换失败,请换一个文件试试',
        );
      }
    }
    setBusyText('');
    await accept(handles);
  };

  const paste = async () => {
    setError('');
    const res = await window.api.pasteImage();
    if (!res.ok) return setError(res.error);
    if (res.value) await accept([res.value]);
  };

  const remove = async (index: number) => {
    await window.api.discardImage({ imageId: items[index].imageId });
    setItems(items.filter((_, i) => i !== index));
    setError('');
  };

  /** 替换:选一张新图换掉这一页,位置不变。 */
  const replace = async (index: number) => {
    setError('');
    const res = await window.api.pickFiles();
    if (!res.ok) return setError(res.error);
    const first = res.value.find((f) => f.kind === 'image');
    for (const f of res.value)
      if (f !== first && f.kind === 'image')
        await window.api.discardImage({ imageId: f.handle.imageId });
    if (!first || first.kind !== 'image') {
      if (res.value.length > 0) setError('替换时请选择一张图片');
      return;
    }
    await window.api.discardImage({ imageId: items[index].imageId });
    setItems(items.map((it, i) => (i === index ? first.handle : it)));
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setItems(next);
  };

  const submit = async () => {
    setError('');
    setStep({ name: 'submitting' });
    const res = await window.api.submitPaper({
      imageIds: items.map((i) => i.imageId),
      title,
    });
    if (!res.ok) {
      setError(res.error);
      return setStep({ name: 'title' });
    }
    setItems([]);
    setStep(
      res.value.kind === 'duplicate'
        ? {
            name: 'duplicate',
            paperId: res.value.paperId,
            title: res.value.title,
          }
        : {
            name: 'done',
            paperId: res.value.paperId,
            title: title.trim() || defaultPaperTitle(),
          },
    );
  };

  const reset = () => {
    setTitle('');
    setError('');
    setStep({ name: 'edit' });
  };

  const cancelTitle = () => {
    setError('');
    setStep({ name: 'edit' });
  };

  const toTitle = () => {
    setTitle(defaultPaperTitle());
    setError('');
    setStep({ name: 'title' });
  };

  if (step.name === 'submitting')
    return (
      <Page title="上传错题">
        <Waiting title="正在提交…" fill />
      </Page>
    );

  if (step.name === 'done')
    return (
      <Page title="上传错题">
        <Done
          paperId={step.paperId}
          title={step.title}
          onOpenLibrary={props.onOpenLibrary}
          onMore={reset}
        />
      </Page>
    );

  if (step.name === 'duplicate')
    return (
      <Page title="上传错题">
        <div className="max-w-xl space-y-6">
          <p className="text-lg">
            这份试卷已经识别过了,标签是「{step.title}」,没有重复生成。
          </p>
          <div className="flex gap-4">
            <button
              type="button"
              className={btn.primary}
              onClick={props.onOpenLibrary}
            >
              进入错题库
            </button>
            <button type="button" className={btn.secondary} onClick={reset}>
              继续上传
            </button>
          </div>
        </div>
      </Page>
    );

  if (step.name === 'title')
    return (
      <Page title="上传错题">
        <div className="max-w-xl space-y-6">
          <p className="text-white/75">
            共 {items.length} 页。给这份试卷起个标签,方便以后在错题库里找。
          </p>
          <label className="flex items-center gap-4">
            <span className="shrink-0 text-lg">标签名称</span>
            <input
              value={title}
              maxLength={PAPER_TITLE_MAX_LENGTH}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={defaultPaperTitle()}
              className={inputClass}
            />
          </label>
          {error && <Note tone="error">{error}</Note>}
          <div className="flex gap-4">
            <button type="button" className={btn.primary} onClick={submit}>
              上传错题库
            </button>
            <button
              type="button"
              className={btn.secondary}
              onClick={cancelTitle}
            >
              取消
            </button>
          </div>
          <p className="text-xs text-white/50">
            照片会发送给阿里云百炼识别,标签只保存在本机。请确认没有拍到姓名、学校等个人信息。
          </p>
        </div>
      </Page>
    );

  return (
    <Page title="上传错题">
      <div className="grid h-full gap-6 lg:grid-cols-[minmax(0,280px)_1fr]">
        <div className="min-h-0 overflow-y-auto rounded-3xl bg-white/10 p-3 ring-1 ring-white/15">
          {items.length === 0 ? (
            <p className="grid h-full min-h-40 place-items-center text-white/60">
              图片列表
            </p>
          ) : (
            <ol className="space-y-3">
              {items.map((it, i) => (
                <li
                  key={it.imageId}
                  draggable
                  onDragStart={() => (dragFrom.current = i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragFrom.current !== null) move(dragFrom.current, i);
                    dragFrom.current = null;
                  }}
                  className="rounded-2xl bg-black/20 p-2 ring-1 ring-white/15"
                >
                  <img
                    src={it.previewDataUrl}
                    alt={`第 ${i + 1} 页`}
                    draggable={false}
                    className="max-h-40 w-full rounded-xl object-contain"
                  />
                  <div className="mt-2 space-y-2 text-sm">
                    <span className="block whitespace-nowrap font-semibold text-mint">
                      第 {i + 1} 页
                    </span>
                    <span className="grid grid-cols-4 gap-1">
                      <button
                        type="button"
                        aria-label="上移"
                        className={`${btn.small} !px-0 whitespace-nowrap`}
                        disabled={i === 0}
                        onClick={() => move(i, i - 1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label="下移"
                        className={`${btn.small} !px-0 whitespace-nowrap`}
                        disabled={i === items.length - 1}
                        onClick={() => move(i, i + 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className={`${btn.small} !px-0 whitespace-nowrap`}
                        onClick={() => replace(i)}
                      >
                        替换
                      </button>
                      <button
                        type="button"
                        className={`${btn.small} !px-0 whitespace-nowrap`}
                        onClick={() => remove(i)}
                      >
                        删除
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex min-h-0 flex-col gap-5">
          <p className="text-white/75">
            添加试卷的照片或 PDF(最多 {MAX_PAGES_PER_PAPER} 页,按页码顺序)。
            只传一张就识别这张上所有的错题和没做的题;传多张会当作同一份试卷一起识别。
          </p>
          <div className="flex flex-wrap gap-4">
            <button
              type="button"
              className={btn.secondary}
              onClick={addFiles}
              disabled={full || busyText !== ''}
            >
              ＋ 添加图片或 PDF
            </button>
            <button
              type="button"
              className={btn.secondary}
              onClick={paste}
              disabled={full || busyText !== ''}
            >
              ＋ 添加粘贴截图
            </button>
          </div>
          {full && (
            <Note tone="info">
              已经 {MAX_PAGES_PER_PAPER} 页了,再多请分次提交。
            </Note>
          )}
          {busyText && <Waiting title={busyText} />}
          {error && <Note tone="error">{error}</Note>}
          <div className="mt-auto flex justify-end">
            <button
              type="button"
              className={btn.primary}
              disabled={items.length === 0 || busyText !== ''}
              onClick={toTitle}
            >
              结束
            </button>
          </div>
        </div>
      </div>
    </Page>
  );
}

/** 提交后的结果页:识别在后台进行,这里轮询状态,给出带数字的结果。 */
function Done(props: {
  paperId: string;
  title: string;
  onOpenLibrary: () => void;
  onMore: () => void;
}) {
  const [paper, setPaper] = useState<PaperSummary | null>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const list = await window.api.listPapers({ allTerms: true });
      if (stop) return;
      const found = list.find((p) => p.id === props.paperId) ?? null;
      setPaper(found);
      if (!found || found.status === 'processing') setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [props.paperId]);

  const processing = !paper || paper.status === 'processing';
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center space-y-6 text-center">
      {processing ? (
        <Waiting
          title="正在识别…"
          hint={`标签「${props.title}」。题目多时可能要一两分钟,可以先去做别的,稍后在错题库查看。`}
        />
      ) : paper.status === 'failed' ? (
        <>
          <Note tone="error">
            「{paper.title}」识别失败:{paper.errorMessage ?? '请重试'}
          </Note>
          <p className="text-sm text-white/60">
            图片已保存在本机,到错题库里点「重试」即可。
          </p>
        </>
      ) : paper.totalCount === 0 ? (
        <p className="text-lg">
          「{paper.title}」识别完成,没有发现做错或没做的题。
        </p>
      ) : (
        <p className="text-lg">
          错误题已经上传,标签为「{paper.title}」,识别出 {paper.totalCount}{' '}
          道,其中 {paper.pendingCount} 道待确认,请去错题库进行确认。
        </p>
      )}
      <div className="flex justify-center gap-4">
        <button
          type="button"
          className={btn.primary}
          onClick={props.onOpenLibrary}
        >
          进入错题库
        </button>
        <button type="button" className={btn.secondary} onClick={props.onMore}>
          继续上传
        </button>
      </div>
    </div>
  );
}
