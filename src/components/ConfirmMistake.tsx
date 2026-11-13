import { useEffect, useState } from 'react';
import type { MistakeDetail, Taxonomy } from '../shared/ipc';
import type { EditableFields } from '../shared/mistakes';
import { MarkdownView } from './MarkdownView';

type Fields = Omit<EditableFields, 'mistakeId'>;

const field =
  'w-full rounded-2xl bg-black/20 px-4 py-3 text-white outline-none ring-1 ring-white/20 focus:ring-2 focus:ring-mint';
const primary =
  'h-14 rounded-full bg-gradient-to-b from-[#b6ffd8] to-[#22c97a] px-8 text-lg font-bold text-ink transition active:scale-95 disabled:opacity-50';
const secondary =
  'h-14 rounded-full bg-white/15 px-6 font-semibold ring-1 ring-white/30 transition hover:bg-white/25 disabled:opacity-50';

function Labeled(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-white/75">{props.label}</span>
      {props.children}
    </label>
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

  return (
    <div>
      <button
        type="button"
        className={`${secondary} mb-4 !h-10`}
        onClick={onBack}
      >
        ← 返回
      </button>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,320px)_1fr]">
        <div className="space-y-3">
          {detail.paperTitle && (
            <p className="text-sm text-white/60">试卷:{detail.paperTitle}</p>
          )}
          {detail.imageDataUrls.map((url, i) => (
            <img
              key={url.slice(-32) + i}
              src={url}
              alt={`错题照片 第 ${i + 1} 张`}
              className="w-full rounded-2xl ring-1 ring-white/20"
            />
          ))}
        </div>

        <div className="space-y-5">
          {detail.incomplete && (
            <p
              role="alert"
              className="rounded-2xl bg-sun/20 px-4 py-3 text-sm text-sun"
            >
              这道题可能跨页或被截断。如果内容不全,请核对后修改,或补传缺的那一页。
            </p>
          )}
          {detail.analysis?.label && (
            <p className="text-sm font-semibold text-mint">
              识别到:{detail.analysis.label}
            </p>
          )}
          {detail.analysis?.figureKind &&
            detail.analysis.figureKind !== 'none' && (
              <p className="text-sm text-white/70">
                原题带图:{detail.analysis.figureNote || '(没有说明)'}
              </p>
            )}
          {detail.analysis?.warnings.map((w) => (
            <p
              key={w}
              role="alert"
              className="rounded-2xl bg-sun/20 px-4 py-3 text-sm text-sun"
            >
              {w}
            </p>
          ))}

          <Labeled label="题目(可修改,支持 Markdown 和 $公式$)">
            <textarea
              className={`${field} font-mono`}
              rows={3}
              value={fields.questionMarkdown}
              onChange={(e) => set({ questionMarkdown: e.target.value })}
            />
          </Labeled>
          <div className="rounded-2xl bg-white p-4 text-ink">
            <MarkdownView>{fields.questionMarkdown}</MarkdownView>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Labeled label="孩子的答案">
              <input
                className={`${field} font-mono`}
                value={fields.studentAnswer}
                onChange={(e) => set({ studentAnswer: e.target.value })}
              />
            </Labeled>
            <Labeled label="标准答案(请核对,识别可能有误)">
              <input
                className={`${field} font-mono`}
                value={fields.correctAnswer}
                onChange={(e) => set({ correctAnswer: e.target.value })}
              />
            </Labeled>
          </div>
          <Labeled label="孩子的解题过程">
            <textarea
              className={`${field} font-mono`}
              rows={3}
              value={fields.studentWorkMarkdown}
              onChange={(e) => set({ studentWorkMarkdown: e.target.value })}
            />
          </Labeled>

          <Labeled label="知识点">
            <select
              className={`${field} appearance-none`}
              value={fields.knowledgePointCode}
              onChange={(e) => set({ knowledgePointCode: e.target.value })}
            >
              {taxonomy.knowledgePoints.map((k) => (
                <option key={k.code} value={k.code} className="text-ink">
                  {k.label}
                </option>
              ))}
            </select>
          </Labeled>

          <fieldset>
            <legend className="mb-2 text-sm text-white/75">
              错误原因(选一个主要原因)
            </legend>
            <div className="space-y-2">
              {taxonomy.causes.map((c) => {
                const cand = candidates.get(c.code);
                const selected = causeCode === c.code;
                return (
                  <label
                    key={c.code}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl px-4 py-3 ring-1 transition ${
                      selected
                        ? 'bg-white/20 ring-mint'
                        : 'bg-white/5 ring-white/15 hover:bg-white/10'
                    }`}
                  >
                    <input
                      type="radio"
                      name="cause"
                      className="mt-1.5"
                      checked={selected}
                      onChange={() => setCauseCode(c.code)}
                    />
                    <span>
                      <span className="font-semibold">{c.label}</span>
                      {cand && (
                        <span className="ml-2 text-xs text-mint">
                          AI 把握 {Math.round(cand.confidence * 100)}%
                        </span>
                      )}
                      <span className="block text-sm text-white/60">
                        {cand?.evidence || c.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="text-sun">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              className={primary}
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
              {detail.status === 'active' ? '保存修改' : '确认'}
            </button>
            <button
              type="button"
              className={secondary}
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
          </div>
        </div>
      </div>
    </div>
  );
}
