import { useCallback, useEffect, useState } from 'react';
import {
  practiceIssueLabels,
  type PracticeReview,
  type PracticeReviewDecision,
} from '../shared/practice';
import { FigureView } from './FigureView';
import { MarkdownView } from './MarkdownView';
import { Note, Page, Waiting, btn } from './ui';

const statusLabels: Record<PracticeReview['status'], string> = {
  report: '待核对',
  keep: '核对后保留',
  void: '已作废',
  restore: '已恢复计入',
};

const outcomeLabels: Record<NonNullable<PracticeReview['outcome']>, string> = {
  correct: '答对',
  wrong: '答错',
  unsure: '不会',
  skipped: '未作答',
  unknown: '历史状态不明',
};

export function PracticeReviewPage({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<PracticeReview[] | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    setError('');
    try {
      const result = await window.api.listPracticeReviews();
      if (result.ok) setItems(result.value);
      else setError(result.error);
    } catch {
      setError('暂时无法加载复核记录。');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <Page
      title="练习题复核"
      description="家长可在本机核对申报的题目；申报本身不会改分。"
      headerExtra={
        <button type="button" className={btn.small} onClick={onBack}>
          返回错题库
        </button>
      }
    >
      <div className="mx-auto max-w-4xl space-y-4">
        {error && (
          <div className="space-y-2">
            <Note tone="error">{error}</Note>
            <button
              type="button"
              className={btn.small}
              onClick={() => void reload()}
            >
              重新加载
            </button>
          </div>
        )}
        {items === null && !error && <Waiting title="正在加载复核记录…" />}
        {items?.length === 0 && <Note tone="info">还没有申报的练习题。</Note>}
        {items?.map((item) => (
          <ReviewCard
            key={`${item.questionId}:${item.status}`}
            item={item}
            onSaved={reload}
          />
        ))}
      </div>
    </Page>
  );
}

function ReviewCard({
  item,
  onSaved,
}: {
  item: PracticeReview;
  onSaved: () => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const resolve = async (action: PracticeReviewDecision) => {
    setBusy(true);
    setError('');
    try {
      const result = await window.api.resolvePracticeReview({
        questionId: item.questionId,
        action,
        note: note.trim(),
      });
      if (result.ok) await onSaved();
      else setError(result.error);
    } catch {
      setError('暂时无法保存复核结果，请重试。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="rounded-3xl bg-white/5 p-5 ring-1 ring-inset ring-white/10">
      <summary className="cursor-pointer rounded-sm font-semibold focus-visible:outline-mint">
        <span className="mr-2 text-mint">{statusLabels[item.status]}</span>
        <span className="text-sm text-white/70">
          {practiceIssueLabels[item.reason]}
        </span>
        <span className="ml-2 block max-w-full truncate text-sm font-normal text-white/70">
          {item.questionMarkdown.replace(/\s+/g, ' ').slice(0, 100)}
        </span>
      </summary>
      <div className="mt-4 space-y-4">
        <div className="space-y-2 rounded-2xl bg-white p-4 text-ink [overflow-wrap:anywhere]">
          <MarkdownView>{item.questionMarkdown}</MarkdownView>
          {item.figure && <FigureView figure={item.figure} />}
          {item.options.length > 0 && (
            <ol className="list-[upper-alpha] space-y-1 pl-6">
              {item.options.map((option, index) => (
                <li key={index}>
                  <MarkdownView inline>{option}</MarkdownView>
                </li>
              ))}
            </ol>
          )}
        </div>
        {item.outcome && (
          <p>
            首次作答：{item.submittedAnswer || '—'}（
            {outcomeLabels[item.outcome]}）
          </p>
        )}
        {item.correctAnswer === null ? (
          <p className="text-sm text-white/70">练习提交前不展示答案或解析。</p>
        ) : (
          <p>
            记录的标准答案：{item.correctAnswer}
            {item.unit && ` ${item.unit}`}
          </p>
        )}
        {item.solutionMarkdown && (
          <div className="text-sm text-white/75">
            <MarkdownView>{item.solutionMarkdown}</MarkdownView>
          </div>
        )}
        {item.decisionNote && (
          <p className="text-sm text-white/75 [overflow-wrap:anywhere]">
            复核理由：{item.decisionNote}
          </p>
        )}
        {(item.status === 'report' || item.status === 'void') && (
          <div className="space-y-2">
            <label className="block text-sm text-white/75">
              {item.status === 'void' ? '恢复理由' : '复核理由'}
              <textarea
                className="mt-1 block w-full rounded-xl bg-black/20 p-3 ring-1 ring-white/20 focus-visible:outline-mint"
                maxLength={200}
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {item.status === 'report' ? (
                <>
                  <button
                    type="button"
                    className={btn.small}
                    disabled={busy || !note.trim()}
                    onClick={() => void resolve('keep')}
                  >
                    核对后保留
                  </button>
                  <button
                    type="button"
                    className={btn.danger}
                    disabled={busy || !note.trim()}
                    onClick={() => void resolve('void')}
                  >
                    确认作废并重算
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={btn.small}
                  disabled={busy || !note.trim()}
                  onClick={() => void resolve('restore')}
                >
                  恢复计入并重算
                </button>
              )}
            </div>
            <p className="text-xs text-white/60">
              作废后保留原题与作答记录，但不再计入学情；恢复会重新纳入合格证据。
            </p>
          </div>
        )}
        {error && <Note tone="error">{error}</Note>}
      </div>
    </details>
  );
}
