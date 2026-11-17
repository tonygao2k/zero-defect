import { useEffect, useRef, useState } from 'react';
import {
  Note,
  Page,
  ScrollArea,
  Waiting,
  btn,
  iconBtn,
  inputClass,
} from '../components/ui';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CameraIcon,
  ReplaceIcon,
  TrashIcon,
} from '../components/Icons';
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
      <Page title="上传错题" scrollKey={step.name}>
        <Waiting title="正在提交…" fill />
      </Page>
    );

  if (step.name === 'done')
    return (
      <Page title="上传错题" scrollKey={step.name}>
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
      <Page title="上传错题" scrollKey={step.name}>
        <div className="max-w-2xl space-y-6 rounded-3xl bg-white/5 p-6 ring-1 ring-inset ring-white/10">
          <p className="text-lg">
            这份试卷已经识别过了,标签是「{step.title}」,没有重复生成。
          </p>
          <div className="flex flex-wrap gap-3">
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
      <Page
        title="上传错题"
        scrollKey={step.name}
        description="最后一步，为这份试卷添加一个方便查找的标签。"
        headerExtra={
          <span className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs text-mint">
            2 / 2 · 确认上传
          </span>
        }
        footer={
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-white/60">
              共 {items.length} 页，按当前顺序识别
            </span>
            <div className="flex gap-3">
              <button
                type="button"
                className={btn.secondary}
                onClick={cancelTitle}
              >
                返回整理
              </button>
              <button type="button" className={btn.primary} onClick={submit}>
                上传并识别
              </button>
            </div>
          </div>
        }
      >
        <div className="max-w-2xl space-y-5">
          <section className="rounded-3xl bg-white/5 p-6 ring-1 ring-inset ring-white/10">
            <h2 className="mb-5 flex items-center gap-2.5 font-semibold">
              <span className="text-xs text-mint/70">01</span>试卷标签
            </h2>
            <label className="block">
              <span className="mb-2 block text-sm text-white/75">标签名称</span>
              <input
                value={title}
                maxLength={PAPER_TITLE_MAX_LENGTH}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={defaultPaperTitle()}
                className={inputClass}
              />
            </label>
            <p className="mt-3 text-xs leading-relaxed text-white/50">
              可以使用日期、科目或考试名称，之后在错题库里查找。
            </p>
          </section>
          <div className="rounded-2xl bg-sun/10 px-5 py-4 text-sm leading-relaxed text-sun/85 ring-1 ring-inset ring-sun/20">
            照片会发送给阿里云百炼识别，标签只保存在本机。请确认没有拍到姓名、学校等个人信息。
          </div>
          {error && <Note tone="error">{error}</Note>}
        </div>
      </Page>
    );

  return (
    <Page
      title="上传错题"
      fixed
      scrollKey={step.name}
      description="把同一份试卷的照片或 PDF 放在一起，整理后开始识别。"
      headerExtra={
        <span className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs text-mint">
          1 / 2 · 整理试卷
        </span>
      }
      footer={
        <div className="flex items-center justify-between gap-4">
          <div aria-live="polite">
            <p className="text-sm text-white/80">
              已经添加{' '}
              <span className="font-semibold text-mint">{items.length}</span>{' '}
              页，最多 {MAX_PAGES_PER_PAPER} 页
            </p>
            <p className="mt-1 text-xs text-white/50">
              确认页码顺序后，进入下一步。
            </p>
          </div>
          <button
            type="button"
            className={btn.primary}
            disabled={items.length === 0 || busyText !== ''}
            onClick={toTitle}
          >
            下一步
          </button>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 p-1">
        <section className="shrink-0 rounded-3xl bg-white/5 p-5 ring-1 ring-inset ring-white/10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-semibold">添加试卷</h2>
              <p className="mt-2 text-sm text-white/60">
                最多 {MAX_PAGES_PER_PAPER} 页，多页将作为同一份试卷识别。
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className={`${btn.secondary} flex w-44 items-center justify-center gap-2`}
                onClick={addFiles}
                disabled={full || busyText !== ''}
              >
                <span aria-hidden="true">＋</span>图片或 PDF
              </button>
              <button
                type="button"
                className={`${btn.secondary} flex w-44 items-center justify-center gap-2`}
                onClick={paste}
                disabled={full || busyText !== ''}
              >
                <span aria-hidden="true">＋</span>粘贴截图
              </button>
            </div>
          </div>
          {full && (
            <div className="mt-3">
              <Note tone="info">
                已经 {MAX_PAGES_PER_PAPER} 页了，再多请分次提交。
              </Note>
            </div>
          )}
          {busyText && (
            <div className="mt-5">
              <Waiting title={busyText} />
            </div>
          )}
          {error && (
            <div className="mt-3">
              <Note tone="error">{error}</Note>
            </div>
          )}
        </section>

        <section aria-label="试卷页面" className="flex min-h-0 flex-1 flex-col">
          <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">整理页码</h2>
            <p className="text-xs text-white/50">拖动卡片或使用箭头调整顺序</p>
          </div>
          <ScrollArea
            className="@container min-h-0 flex-1"
            contentClassName="overflow-y-auto overscroll-contain pr-2 pb-1"
          >
            {items.length === 0 ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-white/20 bg-white/5 p-6 text-center">
                <CameraIcon className="h-9 w-9 text-mint/60" />
                <p className="text-sm text-white/80">先添加第一张试卷</p>
                <p className="text-xs text-white/50">
                  会识别图片中做错或未作答的题目。
                </p>
              </div>
            ) : (
              <ol className="grid grid-cols-2 gap-4 @min-[850px]:grid-cols-3">
                {items.map((it, i) => (
                  <li
                    key={it.imageId}
                    draggable={busyText === ''}
                    onDragStart={() => (dragFrom.current = i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragFrom.current !== null && !busyText)
                        move(dragFrom.current, i);
                      dragFrom.current = null;
                    }}
                    className="min-w-0 rounded-3xl bg-white/5 p-3 ring-1 ring-inset ring-white/10"
                  >
                    <div className="mb-3 flex items-center justify-between gap-2 px-1">
                      <span className="text-sm font-semibold text-mint">
                        第 {i + 1} 页
                      </span>
                      <span className="text-xs text-white/40">
                        {i + 1} / {items.length}
                      </span>
                    </div>
                    <div className="rounded-2xl bg-black/15 p-2">
                      <img
                        src={it.previewDataUrl}
                        alt={`第 ${i + 1} 页`}
                        draggable={false}
                        className="h-40 w-full rounded-lg object-contain"
                      />
                    </div>
                    <div
                      className="mt-3 flex justify-center gap-2"
                      role="group"
                      aria-label={`第 ${i + 1} 页操作`}
                    >
                      <button
                        type="button"
                        aria-label="上移"
                        title="上移一页"
                        className={iconBtn}
                        disabled={i === 0 || busyText !== ''}
                        onClick={() => move(i, i - 1)}
                      >
                        <ArrowUpIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="下移"
                        title="下移一页"
                        className={iconBtn}
                        disabled={i === items.length - 1 || busyText !== ''}
                        onClick={() => move(i, i + 1)}
                      >
                        <ArrowDownIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="替换"
                        title="替换图片"
                        className={iconBtn}
                        disabled={busyText !== ''}
                        onClick={() => replace(i)}
                      >
                        <ReplaceIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="删除"
                        title="删除这一页"
                        className={iconBtn}
                        disabled={busyText !== ''}
                        onClick={() => remove(i)}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </ScrollArea>
        </section>
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
    <div className="mx-auto flex max-w-2xl flex-col items-center space-y-6 rounded-3xl bg-white/5 p-8 text-center ring-1 ring-inset ring-white/10">
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
      <div className="flex flex-wrap justify-center gap-3">
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
