import { useEffect, useState } from 'react';
import type { MistakeDetail, Taxonomy } from '../shared/ipc';
import type { EditableFields } from '../shared/mistakes';
import { RotateLeftIcon, RotateRightIcon } from './Icons';
import { ScrollArea, btn } from './ui';

type Fields = Omit<EditableFields, 'mistakeId'>;

const field =
  'w-full rounded-2xl bg-black/20 px-4 py-3 text-white outline-none ring-1 ring-white/20 focus:ring-2 focus:ring-mint';
const iconButton =
  'grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white/80 ring-1 ring-white/15 transition hover:bg-white/20 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint disabled:opacity-50';

function Labeled(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-white/75">{props.label}</span>
      {props.children}
    </label>
  );
}

function RotatableImage(props: { src: string; alt: string }) {
  const [src, setSrc] = useState(props.src);
  const [busy, setBusy] = useState(false);

  const rotate = (dir: 1 | -1) => {
    setBusy(true);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalHeight;
      canvas.height = img.naturalWidth;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((dir * Math.PI) / 2);
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
        setSrc(canvas.toDataURL('image/jpeg', 0.92));
      }
      setBusy(false);
    };
    img.onerror = () => setBusy(false);
    img.src = src;
  };

  return (
    <div className="space-y-3">
      <div className="flex min-h-24 items-center justify-center rounded-2xl bg-black/15 p-2 ring-1 ring-white/10">
        <img
          src={src}
          alt={props.alt}
          className="max-h-[55vh] w-full rounded-xl object-contain min-[900px]:max-h-[min(55vh,calc(100cqh-11rem))]"
        />
      </div>
      <div className="flex justify-center gap-3">
        <button
          type="button"
          aria-label="向左旋转 90 度"
          title="向左旋转 90 度"
          disabled={busy}
          className={iconButton}
          onClick={() => rotate(-1)}
        >
          <RotateLeftIcon className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="向右旋转 90 度"
          title="向右旋转 90 度"
          disabled={busy}
          className={iconButton}
          onClick={() => rotate(1)}
        >
          <RotateRightIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export function ConfirmMistake(props: {
  mistakeId: string;
  onDone: (message: string) => void;
  onBack: () => void;
}) {
  const { mistakeId, onDone, onBack } = props;
  const [detail, setDetail] = useState<MistakeDetail | null>(null);
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);
  const [causeCode, setCauseCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);

  useEffect(() => {
    void Promise.all([
      window.api.getMistake({ mistakeId }),
      window.api.getTaxonomy(),
    ]).then(([d, t]) => {
      if (!d.ok) return setError(d.error);
      setDetail(d.value);
      setFields(d.value.fields);
      setCauseCode(d.value.analysis?.recommendedRootCause ?? '');
      setTaxonomy(t);
    });
  }, [mistakeId]);

  if (!detail || !fields || !taxonomy) {
    return <p className="text-white/70">{error || '加载中…'}</p>;
  }

  const set = (patch: Partial<Fields>) => setFields({ ...fields, ...patch });
  const candidates = new Map(
    (detail.analysis?.rootCauses ?? []).map((c) => [c.code, c]),
  );
  const payload = { mistakeId, ...fields };

  const run = async (
    action: () => Promise<{ ok: boolean; error?: string }>,
    doneText: string,
  ) => {
    setBusy(true);
    setError('');
    const res = await action();
    setBusy(false);
    if (res.ok) onDone(doneText);
    else setError(res.error ?? '操作失败');
  };

  const warnings = [
    ...(detail.incomplete
      ? ['这道题可能跨页或被截断，请核对原图，或补传缺少的页面。']
      : []),
    ...(detail.analysis?.warnings ?? []),
  ];
  const selectedCause = taxonomy.causes.find((c) => c.code === causeCode);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="mb-5 flex shrink-0 items-center gap-4">
        <button type="button" className={btn.small} onClick={onBack}>
          ← 返回
        </button>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm text-white/60"
            title={detail.paperTitle ?? undefined}
          >
            {detail.paperTitle || '错题详情'}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs text-mint ring-1 ring-white/10">
          {detail.status === 'active' ? '已确认' : '待确认'}
        </span>
      </header>

      {/* 详情只有这一个滚动容器；原图随内容停靠，原因选项自然展开。 */}
      <ScrollArea
        className="min-h-0 flex-1"
        contentClassName="overflow-y-auto overscroll-contain pr-3 pb-3 [container-type:size]"
      >
        <div className="grid items-start gap-6 min-[900px]:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.4fr)]">
          <aside
            aria-label="原始试卷"
            className="min-w-0 rounded-3xl bg-white/5 p-4 ring-1 ring-inset ring-white/10 min-[900px]:sticky min-[900px]:top-0"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-white/80">原始试卷</h2>
              {detail.imageDataUrls.length > 0 && (
                <span className="text-xs text-white/50">
                  {imageIndex + 1} / {detail.imageDataUrls.length}
                </span>
              )}
            </div>
            {detail.imageDataUrls.length > 1 && (
              <div
                className="mb-3 flex flex-wrap gap-2"
                role="group"
                aria-label="选择试卷页码"
              >
                {detail.imageDataUrls.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={imageIndex === i}
                    onClick={() => setImageIndex(i)}
                    className={`rounded-lg px-3 py-1.5 text-xs transition ${imageIndex === i ? 'bg-mint text-ink' : 'bg-white/10 text-white/65 hover:bg-white/20'}`}
                  >
                    第 {i + 1} 页
                  </button>
                ))}
              </div>
            )}
            {detail.imageDataUrls.length > 0 ? (
              detail.imageDataUrls.map((url, i) => (
                <div key={i} hidden={imageIndex !== i}>
                  <RotatableImage src={url} alt={`错题照片 第 ${i + 1} 张`} />
                </div>
              ))
            ) : (
              <p className="py-12 text-center text-sm text-white/50">
                暂无原始图片
              </p>
            )}
          </aside>

          <div className="@container min-w-0 space-y-5">
            <section className="rounded-3xl bg-white/5 p-5 ring-1 ring-inset ring-white/10">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2.5 font-semibold">
                  <span className="text-xs font-medium text-mint/70">01</span>
                  核对答案
                </h2>
                {detail.analysis?.label && (
                  <span className="text-sm text-mint">
                    {detail.analysis.label}
                  </span>
                )}
              </div>
              <div className="grid gap-4 @min-[420px]:grid-cols-2">
                <Labeled label="孩子的答案">
                  <input
                    className={`${field} font-mono`}
                    value={fields.studentAnswer}
                    onChange={(e) => set({ studentAnswer: e.target.value })}
                  />
                </Labeled>
                <Labeled label="标准答案">
                  <input
                    className={`${field} font-mono`}
                    value={fields.correctAnswer}
                    onChange={(e) => set({ correctAnswer: e.target.value })}
                  />
                </Labeled>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-white/50">
                请对照原图核对，识别结果可能有误。
              </p>
              {detail.analysis?.figureKind &&
                detail.analysis.figureKind !== 'none' && (
                  <p className="mt-3 border-t border-white/10 pt-3 text-sm leading-relaxed text-white/60">
                    原题配图：{detail.analysis.figureNote || '请参照左侧原图'}
                  </p>
                )}
            </section>

            {warnings.length > 0 && (
              <div
                role="note"
                aria-label="核对提醒"
                className="rounded-2xl bg-sun/10 px-4 py-3 ring-1 ring-inset ring-sun/20"
              >
                <p className="mb-1 text-sm font-semibold text-sun">需要留意</p>
                <ul className="space-y-1 text-sm leading-relaxed text-sun/85">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <fieldset className="min-w-0">
              <legend className="mb-1 flex items-center gap-2.5 font-semibold">
                <span className="text-xs font-medium text-mint/70">02</span>
                选择错误原因
              </legend>
              <p className="mb-4 text-xs text-white/50">
                选择一个最主要的原因，帮助安排后续练习。
              </p>
              <div className="grid gap-2.5 @min-[420px]:grid-cols-2">
                {taxonomy.causes.map((c) => {
                  const cand = candidates.get(c.code);
                  const selected = causeCode === c.code;
                  return (
                    <label
                      key={c.code}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-2xl p-3.5 ring-1 ring-inset transition focus-within:ring-2 focus-within:ring-mint ${
                        selected
                          ? 'bg-mint/10 ring-mint/70'
                          : 'bg-white/5 ring-white/10 hover:bg-white/10 hover:ring-white/25'
                      }`}
                    >
                      <input
                        type="radio"
                        name="cause"
                        className="mt-1 h-3.5 w-3.5 shrink-0 accent-mint"
                        checked={selected}
                        onChange={() => setCauseCode(c.code)}
                      />
                      <span className="min-w-0">
                        <span
                          className={`block text-sm font-semibold ${selected ? 'text-mint' : 'text-white/90'}`}
                        >
                          {c.label}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-white/55">
                          {cand?.evidence || c.description}
                        </span>
                        {cand && (
                          <span className="mt-2 block text-xs text-mint/80">
                            AI 把握 {Math.round(cand.confidence * 100)}%
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>
        </div>
      </ScrollArea>

      <footer className="mt-4 shrink-0 border-t border-white/15 pt-4">
        {error && (
          <p role="alert" className="mb-3 text-sm text-sun">
            {error}
          </p>
        )}
        <div className="flex items-center gap-3">
          <div className="mr-auto min-w-0" aria-live="polite">
            <p className="text-xs text-white/50">主要错误原因</p>
            <p
              className={`mt-1 truncate text-sm ${selectedCause ? 'text-mint' : 'text-white/65'}`}
            >
              {selectedCause?.label || '请选择一个原因'}
            </p>
          </div>
          <button
            type="button"
            className={btn.secondary}
            disabled={busy}
            onClick={() => {
              if (window.confirm('删除这道错题?删除后不能恢复。')) {
                void run(
                  () => window.api.deleteMistake({ mistakeId }),
                  '已删除',
                );
              }
            }}
          >
            删除
          </button>
          <button
            type="button"
            className={btn.primary}
            disabled={busy || !causeCode || !fields.questionMarkdown.trim()}
            onClick={() =>
              run(
                () =>
                  window.api.confirmMistake({
                    ...payload,
                    rootCauseCode: causeCode,
                  }),
                detail.status === 'active' ? '已保存修改' : '已确认',
              )
            }
          >
            {busy
              ? '处理中…'
              : detail.status === 'active'
                ? '保存修改'
                : '确认错题'}
          </button>
        </div>
      </footer>
    </div>
  );
}
