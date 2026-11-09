import { useEffect, useState } from 'react';
import { ConfirmMistake } from '../components/ConfirmMistake';
import { HINT_MAX_LENGTH } from '../shared/analysis';
import type { ImageHandle } from '../shared/ipc';
import type { MistakeSummary } from '../shared/mistakes';

type Step =
  | { name: 'pick' }
  | { name: 'preview'; image: ImageHandle }
  | { name: 'analyzing'; image: ImageHandle }
  /** 一次分析可能得到多道题,按队列逐道确认。 */
  | { name: 'confirm'; queue: string[]; index: number };

/** 常用说明,点一下填入输入框,可以再手动修改(例如把题号改成实际的)。 */
const HINT_PRESETS = [
  '请识别所有错题',
  '请识别红框内的题目',
  '请识别第 1、3、5 题',
  '只识别最后一道大题',
];

const big =
  'h-16 rounded-full bg-white/15 px-8 text-lg font-semibold ring-1 ring-white/30 transition hover:bg-white/25 disabled:opacity-50';
const primary =
  'h-16 rounded-full bg-gradient-to-b from-[#b6ffd8] to-[#22c97a] px-10 text-lg font-bold text-ink transition active:scale-95 disabled:opacity-50';

export function UploadPage() {
  const [step, setStep] = useState<Step>({ name: 'pick' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<MistakeSummary[]>([]);
  const [hint, setHint] = useState('');

  useEffect(() => {
    if (step.name === 'pick')
      void window.api.listMistakes({ status: 'draft' }).then(setDrafts);
  }, [step.name]);

  const reset = (message = '') => {
    setNotice(message);
    setHint('');
    setStep({ name: 'pick' });
  };

  const choose = async (source: 'pick' | 'paste') => {
    setError('');
    setNotice('');
    const res = await (source === 'pick'
      ? window.api.pickImage()
      : window.api.pasteImage());
    if (!res.ok) return setError(res.error);
    if (res.value) setStep({ name: 'preview', image: res.value });
  };

  const analyze = async (image: ImageHandle) => {
    setError('');
    setStep({ name: 'analyzing', image });
    const res = await window.api.analyzeMistake({
      imageId: image.imageId,
      hint: hint.trim() || undefined,
    });
    if (!res.ok) {
      setError(res.error);
      return setStep({ name: 'preview', image });
    }

    if (res.value.kind === 'duplicate') {
      const same = hint.trim() ? '这张图用同样的说明' : '这张图';
      const { pendingIds } = res.value;
      if (pendingIds.length > 0) {
        setNotice(
          `${same}已经分析过,还有 ${pendingIds.length} 道没确认,继续吧。`,
        );
        return setStep({ name: 'confirm', queue: pendingIds, index: 0 });
      }
      return reset(
        `${same}已经分析并确认过了。如果想分析同一张图里的其他题,请换一句说明再试。`,
      );
    }

    const { mistakeIds, skipped, ignoredCorrect } = res.value;
    const notes: string[] = [];
    if (ignoredCorrect > 0)
      notes.push(`另有 ${ignoredCorrect} 道题 AI 核对后认为孩子做对了,已忽略`);
    if (skipped > 0)
      notes.push(`有 ${skipped} 道错题没能识别完整或超出一次的上限,已跳过`);
    setNotice(notes.length > 0 ? `${notes.join(';')}。` : '');
    setStep({ name: 'confirm', queue: mistakeIds, index: 0 });
  };

  const back = async (image: ImageHandle) => {
    await window.api.discardImage({ imageId: image.imageId });
    reset();
  };

  const onConfirmDone = (message: string) => {
    if (step.name !== 'confirm') return;
    if (step.index + 1 < step.queue.length) {
      setNotice(message);
      return setStep({ ...step, index: step.index + 1 });
    }
    reset(
      step.queue.length > 1 ? `${message},这张卷子的题都处理完了` : message,
    );
  };

  return (
    <div className="h-full overflow-y-auto px-12 pb-10 pt-16">
      <h1 className="text-4xl font-semibold">上传错题</h1>

      {step.name === 'pick' && (
        <div className="mt-8 max-w-xl">
          <p className="text-white/75">
            选一张错题或整张卷子的照片。最好能看到孩子的解题过程和批改痕迹,
            下一步可以告诉 AI 要识别哪些题。
          </p>
          <div className="mt-6 flex flex-wrap gap-4">
            <button
              type="button"
              className={primary}
              onClick={() => choose('pick')}
            >
              选择图片
            </button>
            <button
              type="button"
              className={big}
              onClick={() => choose('paste')}
            >
              粘贴截图
            </button>
          </div>
          {notice && (
            <p role="status" className="mt-5 text-mint">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-5 text-sun">
              {error}
            </p>
          )}

          {drafts.length > 0 && (
            <section className="mt-10">
              <h2 className="text-lg font-semibold">还没确认的错题</h2>
              <ul className="mt-3 space-y-2">
                {drafts.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setStep({ name: 'confirm', queue: [d.id], index: 0 })
                      }
                      className="w-full truncate rounded-2xl bg-white/10 px-4 py-3 text-left ring-1 ring-white/15 transition hover:bg-white/20"
                    >
                      {d.knowledgePointLabel
                        ? `${d.knowledgePointLabel} · `
                        : ''}
                      {d.questionMarkdown.replace(/\s+/g, ' ').slice(0, 40)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {(step.name === 'preview' || step.name === 'analyzing') && (
        <div className="mt-8 max-w-2xl">
          <img
            src={step.image.previewDataUrl}
            alt="待分析的照片"
            className="max-h-[50vh] rounded-2xl ring-1 ring-white/20"
          />
          <p className="mt-3 text-xs text-white/50">
            照片会发送给通义千问(阿里云百炼)。请确认没有拍到姓名、学校等个人信息。
          </p>

          <div className="mt-5">
            <label htmlFor="hint" className="mb-2 block text-sm text-white/75">
              告诉 AI 要识别哪些题(可选,不写就识别所有被批改为错误的题)
            </label>
            <div className="mb-3 flex flex-wrap gap-2">
              {HINT_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={step.name === 'analyzing'}
                  onClick={() => setHint(p)}
                  className="rounded-full bg-white/10 px-4 py-1.5 text-sm ring-1 ring-white/20 transition hover:bg-white/20 disabled:opacity-50"
                >
                  {p}
                </button>
              ))}
            </div>
            <textarea
              id="hint"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              disabled={step.name === 'analyzing'}
              maxLength={HINT_MAX_LENGTH}
              rows={2}
              placeholder="例如:请识别第 1、3、5 题 / 请识别红框内的题目 / 红笔是老师批改"
              className="w-full rounded-2xl bg-black/20 px-4 py-3 text-white outline-none ring-1 ring-white/20 placeholder:text-white/40 focus:ring-2 focus:ring-mint disabled:opacity-60"
            />
            <span className="mt-1 block text-right text-xs text-white/40">
              {hint.length} / {HINT_MAX_LENGTH}
            </span>
          </div>

          {step.name === 'analyzing' ? (
            <p role="status" className="mt-6 text-lg text-mint">
              正在识别并分析原因,题目多时可能需要半分钟…
            </p>
          ) : (
            <div className="mt-6 flex flex-wrap gap-4">
              <button
                type="button"
                className={primary}
                onClick={() => analyze(step.image)}
              >
                开始分析
              </button>
              <button
                type="button"
                className={big}
                onClick={() => back(step.image)}
              >
                重新选择
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-5 text-sun">
              {error}
            </p>
          )}
        </div>
      )}

      {step.name === 'confirm' && (
        <div className="mt-8">
          {step.queue.length > 1 && (
            <p className="mb-4 text-lg font-semibold text-mint">
              第 {step.index + 1} / {step.queue.length} 道
            </p>
          )}
          {notice && (
            <p role="status" className="mb-4 text-sm text-white/75">
              {notice}
            </p>
          )}
          <ConfirmMistake
            key={step.queue[step.index]}
            mistakeId={step.queue[step.index]}
            onDone={onConfirmDone}
          />
        </div>
      )}
    </div>
  );
}
