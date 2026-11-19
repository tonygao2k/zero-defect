import { useState } from 'react';
import { practiceIssueLabels, type PracticeIssue } from '../shared/practice';
import { Note, btn } from './ui';

const reasons = Object.entries(practiceIssueLabels) as [
  PracticeIssue,
  string,
][];

export function PracticeQuestionReport({ questionId }: { questionId: string }) {
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const report = async (reason: PracticeIssue) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await window.api.reportPracticeQuestion({
        questionId,
        reason,
      });
      setNotice(
        result.ok
          ? {
              ok: true,
              text: '已记录，可在错题库的「练习题复核」查看。复核前不改变成绩。',
            }
          : { ok: false, text: result.error },
      );
    } catch {
      setNotice({ ok: false, text: '暂时无法记录，请重试。' });
    } finally {
      setBusy(false);
    }
  };

  if (notice?.ok) return <Note tone="ok">{notice.text}</Note>;

  return (
    <details className="text-sm text-white/70">
      <summary className="w-fit cursor-pointer rounded-sm hover:text-white focus-visible:outline-mint">
        题目有问题
      </summary>
      <div className="mt-3 flex flex-wrap gap-2">
        {reasons.map(([reason, label]) => (
          <button
            key={reason}
            type="button"
            className={btn.small}
            disabled={busy}
            onClick={() => void report(reason)}
          >
            {label}
          </button>
        ))}
      </div>
      {notice && <Note tone="error">{notice.text}</Note>}
    </details>
  );
}
