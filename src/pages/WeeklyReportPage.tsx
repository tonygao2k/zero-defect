import { useCallback, useEffect, useState } from 'react';
import { FigureView } from '../components/FigureView';
import { MarkdownView } from '../components/MarkdownView';
import { Note, Page, Waiting, btn } from '../components/ui';
import type {
  WeeklyRecord,
  WeeklyReport,
  WeeklyTopic,
} from '../shared/weekly-report';

const recordLabels: Record<WeeklyRecord['kind'], string> = {
  mistake: '已确认的试卷错题',
  correct: '无提示 · 答对',
  wrong: '无提示 · 答错',
  unsure: '选择了「这题不会」',
  hint: '订正时看过提示',
  assisted: '有提示的作答',
};

const dateText = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return {
    year,
    short: `${month}月${day}日`,
    full: `${year}年${month}月${day}日`,
  };
};

function nextPracticeText(next: NonNullable<WeeklyTopic['next']>) {
  if (next.kind === 'recheck_later')
    return '明天或之后，可以独立做一道同类新题。';
  if (next.kind === 'recheck')
    return '下次可以独立做一道同类新题，看看还记不记得。';
  if (next.kind === 'reinforce')
    return '下次再做一道同类题，练一练容易出错的地方。';
  if (next.kind === 'retry' && next.date)
    return `${dateText(next.date).short}再练一道同类题。`;
  if (next.date) return `${dateText(next.date).short}起可以复习这类题。`;
  return '下次练习时，可以用一道同类题检查是否还记得。';
}

export function WeeklyReportPage({ onPractice }: { onPractice: () => void }) {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [week, setWeek] = useState<string>();

  const load = useCallback(async (weekStart?: string) => {
    setBusy(true);
    setError('');
    try {
      const result = await window.api.getWeeklyReport(
        weekStart ? { weekStart } : undefined,
      );
      if (result.ok) setReport(result.value);
      else setError(result.error);
    } catch {
      setError('暂时无法加载学习周报。');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(week);
  }, [load, week]);

  const start = report && dateText(report.start);
  const end = report && dateText(report.end);
  return (
    <Page
      title="学习周报"
      scrollKey={report?.start}
      description={
        start && end
          ? `${start.full} – ${start.year === end.year ? end.short : end.full}${report.isCurrent ? ' · 本周' : ''}`
          : undefined
      }
      headerExtra={
        report && (
          <div
            className="flex flex-wrap justify-end gap-2"
            aria-label="选择周报日期"
          >
            <button
              type="button"
              className={btn.small}
              disabled={busy || !report.previousStart}
              onClick={() => setWeek(report.previousStart ?? undefined)}
            >
              上一周
            </button>
            <button
              type="button"
              className={btn.small}
              disabled={busy || !report.nextStart}
              onClick={() => setWeek(report.nextStart ?? undefined)}
            >
              下一周
            </button>
          </div>
        )
      }
    >
      {busy ? (
        <Waiting title="正在读取学习记录…" fill />
      ) : error ? (
        <div className="space-y-3">
          <Note tone="error">{error}</Note>
          <button
            type="button"
            className={btn.small}
            onClick={() => void load(week)}
          >
            重新加载
          </button>
        </div>
      ) : report?.topics.length === 0 ? (
        <div className="rounded-3xl bg-white/7 p-6 ring-1 ring-inset ring-white/15">
          <h2 className="text-xl font-semibold">这一周还没有学习记录</h2>
          {report.isCurrent && (
            <p className="mt-2 text-sm leading-relaxed text-white/75">
              确认试卷错题或提交练习作答后，可以在这里查看记录。
            </p>
          )}
        </div>
      ) : (
        report && (
          <div className="mx-auto max-w-5xl space-y-6">
            <dl className="grid gap-3 sm:grid-cols-3">
              {[
                ['独立作答', report.independentCount],
                ['独立答对', report.independentCorrect],
                ['完成跨日复测', report.recheckCount],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-2xl bg-white/10 px-5 py-4 ring-1 ring-inset ring-white/10"
                >
                  <dt className="text-sm text-white/75">{label}</dt>
                  <dd className="mt-1 text-3xl font-semibold tabular-nums text-mint">
                    {value}
                    <span className="ml-1 text-sm font-normal text-white/70">
                      道
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
            <section aria-label="分知识点的学习记录" className="space-y-3">
              {report.topics.map((topic) => (
                <TopicCard key={topic.records[0].id} topic={topic} />
              ))}
            </section>
          </div>
        )
      )}
      {!busy && !error && report?.isCurrent && (
        <div className="mx-auto mt-6 max-w-5xl space-y-4 pb-2">
          {report.duePractice.length > 0 && (
            <section className="rounded-3xl bg-white/7 p-5 ring-1 ring-inset ring-white/15">
              <h2 className="text-lg font-semibold">可以复习了</h2>
              <ul className="mt-3 space-y-2 text-sm text-white/85">
                {report.duePractice.map(({ point, cause, recheck }) => (
                  <li key={JSON.stringify([point, cause])}>
                    <span className="mr-2 text-mint">
                      {recheck ? '跨日复测' : '复习'}
                    </span>
                    <span>{point}</span>
                    <span className="ml-2 text-white/70">{cause}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <button type="button" className={btn.secondary} onClick={onPractice}>
            去智能练习
          </button>
        </div>
      )}
    </Page>
  );
}

function TopicCard({ topic }: { topic: WeeklyTopic }) {
  const evidence = [
    topic.mistakeCount > 0 && `试卷错题 ${topic.mistakeCount} 道`,
    topic.unsureCount > 0 && `${topic.unsureCount} 道选择了「不会」`,
    topic.hintCount > 0 && `有提示记录 ${topic.hintCount} 条`,
  ].filter(Boolean);
  return (
    <article className="rounded-3xl bg-white/7 p-5 ring-1 ring-inset ring-white/15">
      <h2 className="text-lg font-semibold">{topic.point}</h2>
      <p className="mt-0.5 text-sm text-white/70">{topic.cause}</p>
      {evidence.length > 0 && (
        <p className="mt-3 text-sm text-white/80">{evidence.join(' · ')}</p>
      )}
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span>
          {topic.independentCount > 0
            ? `独立做了 ${topic.independentCount} 道，答对 ${topic.independentCorrect} 道`
            : '这一周还没有独立作答记录'}
        </span>
        {topic.independentCount > 0 && topic.independentCount < 3 && (
          <span className="rounded-full bg-sun/15 px-2.5 py-0.5 text-xs font-medium text-sun">
            样本少
          </span>
        )}
      </p>
      <p className="mt-1 text-sm text-white/75">
        {topic.recheckCount > 0
          ? `其中 ${topic.recheckCount} 道是跨日独立复测`
          : '这一周还没有独立复测记录'}
      </p>
      {topic.next && (
        <p className="mt-3 text-sm text-mint">{nextPracticeText(topic.next)}</p>
      )}
      <details className="mt-4 border-t border-white/12 pt-3">
        <summary className="w-fit cursor-pointer rounded-sm text-sm font-semibold focus-visible:outline-mint">
          查看学习记录（{topic.records.length}）
        </summary>
        <ul className="mt-3 space-y-2">
          {topic.records.map((record) => (
            <li key={`${record.kind}:${record.id}`}>
              <RecordDetails record={record} />
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function RecordDetails({ record }: { record: WeeklyRecord }) {
  return (
    <details className="rounded-2xl bg-black/15 px-4 py-3">
      <summary className="cursor-pointer rounded-sm text-sm text-white/90 focus-visible:outline-mint">
        <time dateTime={record.date} className="mr-3 text-white/70">
          {dateText(record.date).short}
        </time>
        {recordLabels[record.kind]}
        {record.hintDate && ' · 跨日复测'}
      </summary>
      <div className="mt-3 space-y-3">
        <div className="space-y-2 rounded-xl bg-white p-4 text-ink [overflow-wrap:anywhere]">
          <MarkdownView>{record.questionMarkdown}</MarkdownView>
          {record.figure && <FigureView figure={record.figure} />}
          {record.options.length > 0 && (
            <ol className="list-[upper-alpha] space-y-1 pl-6">
              {record.options.map((option, index) => (
                <li key={index}>
                  <MarkdownView inline>{option}</MarkdownView>
                </li>
              ))}
            </ol>
          )}
        </div>
        {record.submittedAnswer && (
          <p className="text-sm [overflow-wrap:anywhere]">
            作答 {record.submittedAnswer}
          </p>
        )}
        {record.correctAnswer && (
          <p className="text-sm [overflow-wrap:anywhere]">
            参考答案 {record.correctAnswer}
            {record.unit && ` ${record.unit}`}
          </p>
        )}
        {record.hintDate && (
          <p className="text-sm text-white/70">
            {dateText(record.hintDate).full}看过同类题的订正提示。
          </p>
        )}
      </div>
    </details>
  );
}
