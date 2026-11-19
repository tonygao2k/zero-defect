import { useEffect, useRef, useState } from 'react';
import { FigureView } from '../components/FigureView';
import { Hero } from '../components/Hero';
import { MarkdownView } from '../components/MarkdownView';
import { Note, Page, Waiting, btn } from '../components/ui';
import { APP_DISPLAY_NAME } from '../shared/app-info';
import type {
  PracticeHint,
  PracticeQuestion,
  PracticeResult,
  PracticeSession,
  ReviseResult,
} from '../shared/practice';
import type { HomeStats } from '../shared/stats';

type Stage =
  | { name: 'home' }
  | { name: 'generating' }
  | { name: 'answering'; session: PracticeSession }
  | { name: 'submitting' }
  | { name: 'result'; session: PracticeSession; result: PracticeResult }
  | { name: 'revising'; session: PracticeSession; result: PracticeResult };

const LETTERS = ['A', 'B', 'C', 'D'];

function QuestionCard(props: {
  question: PracticeQuestion;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { question: q } = props;
  return (
    <div className="@container min-w-0 rounded-3xl bg-white p-6 text-ink shadow-lg">
      <div className="text-xl leading-relaxed [overflow-wrap:anywhere]">
        <MarkdownView>{q.questionMarkdown}</MarkdownView>
      </div>
      {q.figure && <FigureView figure={q.figure} />}
      {q.answerType === 'choice' ? (
        <div
          className="mt-6 grid gap-3 @min-[480px]:grid-cols-2"
          role="radiogroup"
        >
          {q.options.map((text, i) => {
            const letter = LETTERS[i];
            const on = props.value === letter;
            return (
              <button
                key={letter}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={props.disabled}
                onClick={() => props.onChange(letter)}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-lg ring-2 transition ${
                  on
                    ? 'bg-emerald-100 ring-emerald-500'
                    : 'bg-slate-50 ring-slate-200 hover:bg-slate-100'
                }`}
              >
                <span className="font-bold">{letter}.</span>
                <span className="min-w-0">
                  <MarkdownView>{text}</MarkdownView>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <label className="mt-6 flex flex-wrap items-center gap-3 text-lg">
          <span className="font-semibold">答案:</span>
          <input
            value={props.value}
            disabled={props.disabled}
            onChange={(e) => props.onChange(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            maxLength={40}
            aria-label="答案"
            className="h-12 min-w-0 w-56 max-w-full rounded-2xl bg-slate-50 px-4 text-ink outline-none ring-2 ring-slate-200 focus:ring-emerald-500 font-mono"
          />
          {q.unit && <span>{q.unit}</span>}
        </label>
      )}
    </div>
  );
}

export function PracticePage() {
  const [stage, setStage] = useState<Stage>({ name: 'home' });
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [error, setError] = useState('');
  const startedAt = useRef(0);

  useEffect(() => {
    if (stage.name === 'home') void window.api.getHomeStats().then(setStats);
  }, [stage.name]);

  const start = async () => {
    setError('');
    setStage({ name: 'generating' });
    const res = await window.api.startPractice();
    if (!res.ok) {
      setError(res.error);
      return setStage({ name: 'home' });
    }
    startedAt.current = Date.now();
    setStage({ name: 'answering', session: res.value });
  };

  if (stage.name === 'generating')
    return (
      <Waiting
        fill
        title="正在为你出题…"
        hint="每道题都会再算一遍确认答案没错,大约需要半分钟。"
      />
    );
  if (stage.name === 'submitting') return <Waiting fill title="正在提交…" />;

  if (stage.name === 'answering')
    return (
      <Answering
        session={stage.session}
        onSubmit={async (answers) => {
          setStage({ name: 'submitting' });
          const res = await window.api.submitPractice({
            sessionId: stage.session.sessionId,
            answers,
            elapsedMs: Date.now() - startedAt.current,
          });
          if (!res.ok) {
            setError(res.error);
            return setStage({ name: 'answering', session: stage.session });
          }
          setError('');
          setStage({
            name: 'result',
            session: stage.session,
            result: res.value,
          });
        }}
        error={error}
      />
    );

  if (stage.name === 'result')
    return (
      <Page
        title="练习结果"
        description="每一次练习，都在积累进步。"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              className={btn.secondary}
              onClick={async () => {
                await window.api.finishPractice({
                  sessionId: stage.session.sessionId,
                });
                setStage({ name: 'home' });
              }}
            >
              结束练习
            </button>
            {stage.result.wrongCount > 0 && (
              <button
                type="button"
                className={btn.primary}
                onClick={() =>
                  setStage({
                    name: 'revising',
                    session: stage.session,
                    result: stage.result,
                  })
                }
              >
                修改错题
              </button>
            )}
          </div>
        }
      >
        <section className="mx-auto max-w-2xl rounded-3xl bg-white/5 p-8 ring-1 ring-inset ring-white/10">
          <p className="text-sm font-semibold text-mint">本次练习已完成</p>
          <h2 className="mt-3 text-2xl font-semibold">
            {stage.result.wrongCount === 0
              ? '全部答对，继续保持！'
              : '完成练习，再把错题弄明白。'}
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="rounded-2xl bg-mint/10 p-5">
              <p className="text-sm text-white/60">正确</p>
              <p className="mt-2 text-4xl font-semibold text-mint">
                {stage.result.correctCount}
                <span className="ml-2 text-sm font-normal">道</span>
              </p>
            </div>
            <div className="rounded-2xl bg-sun/10 p-5">
              <p className="text-sm text-white/60">待订正</p>
              <p className="mt-2 text-4xl font-semibold text-sun">
                {stage.result.wrongCount}
                <span className="ml-2 text-sm font-normal">道</span>
              </p>
            </div>
          </div>
          {stage.result.wrongCount > 0 && (
            <p className="mt-5 text-sm leading-relaxed text-white/60">
              可以现在修改错题，也可以结束练习。这些知识点会记下来，之后还会再练。
            </p>
          )}
        </section>
      </Page>
    );

  if (stage.name === 'revising')
    return (
      <Revising
        session={stage.session}
        wrongIds={stage.result.wrongQuestionIds}
        onDone={async () => {
          await window.api.finishPractice({
            sessionId: stage.session.sessionId,
          });
          setStage({ name: 'home' });
        }}
      />
    );

  const canStart = (stats?.practiceablePairs ?? 0) > 0;
  return (
    <Page
      title="智能练习"
      description={APP_DISPLAY_NAME}
      footer={
        <div className="flex items-center justify-between gap-5">
          <div className="min-w-0 text-sm text-white/60">
            {error ? (
              <Note tone="error">{error}</Note>
            ) : stats && !canStart ? (
              <p>
                {stats.mistakeCount === 0
                  ? '先上传并确认错题，就可以开始练习。'
                  : '当前练习已完成，到了复习时间再来。'}
              </p>
            ) : (
              <p>根据已确认的错题，练习需要巩固的知识点。</p>
            )}
          </div>
          <button
            type="button"
            onClick={start}
            disabled={!canStart}
            className={btn.primary}
          >
            开始练习
          </button>
        </div>
      }
    >
      <div className="@container mx-auto max-w-6xl space-y-5">
        <section className="grid items-center gap-5 rounded-3xl bg-white/5 p-6 ring-1 ring-inset ring-white/10 @min-[560px]:grid-cols-[1fr_160px] @min-[850px]:grid-cols-[1fr_260px]">
          <div>
            <p className="text-sm font-medium text-mint">专属巩固练习</p>
            <h2 className="mt-3 text-2xl font-semibold leading-snug @min-[850px]:text-3xl">
              把每一道错题，
              <br />
              变成下一次的进步。
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/60">
              从错题出发，练习相似题目；完成后再订正，逐步掌握薄弱的知识点。
            </p>
          </div>
          <Hero />
        </section>
        {stats && (
          <section
            aria-label="学习概况"
            className="grid grid-cols-2 gap-4 @min-[850px]:grid-cols-4"
          >
            {[
              {
                label: '错题积累',
                value: stats.mistakeCount,
                unit: '道',
                hint: `涉及 ${stats.knowledgePointCount} 个知识点`,
              },
              {
                label: '累计练习',
                value: stats.answeredCount,
                unit: '道',
                hint: '每一次作答都算数',
              },
              {
                label: '已经掌握',
                value: stats.masteredKnowledgePoints,
                unit: '个',
                hint: '知识点持续巩固',
              },
              {
                label: '还需巩固',
                value: stats.remainingKnowledgePoints,
                unit: '个',
                hint: '一步一步来',
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-3xl bg-white/5 p-5 ring-1 ring-inset ring-white/10"
              >
                <p className="text-sm text-white/60">{item.label}</p>
                <p className="mt-3 text-3xl font-semibold text-mint">
                  {item.value}
                  <span className="ml-2 text-xs font-normal text-white/50">
                    {item.unit}
                  </span>
                </p>
                <p className="mt-2 text-xs text-white/45">{item.hint}</p>
              </div>
            ))}
          </section>
        )}
        {stats &&
          (stats.guidedRecheck.pending > 0 ||
            stats.guidedRecheck.completed > 0) && (
            <section className="rounded-3xl bg-white/5 p-5 ring-1 ring-inset ring-white/10">
              <h2 className="font-semibold">订正后的独立复测</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/70">
                {stats.guidedRecheck.pending} 项待复测；已复测{' '}
                {stats.guidedRecheck.completed} 项，其中{' '}
                {stats.guidedRecheck.correct} 项首次独立答对。
              </p>
              <p className="mt-1 text-sm text-white/60">
                后续练习会优先安排一项待复测内容，用新题检验是否能自己做出来。
              </p>
            </section>
          )}
      </div>
    </Page>
  );
}

function Answering(props: {
  session: PracticeSession;
  error: string;
  onSubmit: (answers: { questionId: string; answer: string }[]) => void;
}) {
  const { questions } = props.session;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const q = questions[index];
  const last = index === questions.length - 1;

  return (
    <Page
      title="练习题"
      scrollKey={q.id}
      description="仔细读题，完成后再提交。"
      headerExtra={
        <span className="shrink-0 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-mint">
          {index + 1} / {questions.length}
        </span>
      }
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            className={btn.secondary}
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
          >
            上一道
          </button>
          {last ? (
            <button
              type="button"
              className={btn.primary}
              onClick={() => {
                const blank = questions.filter(
                  (x) => !(answers[x.id] ?? '').trim(),
                );
                if (
                  blank.length > 0 &&
                  !window.confirm(
                    `还有 ${blank.length} 道题没做,确定提交吗?没做的题算错。`,
                  )
                )
                  return;
                props.onSubmit(
                  questions.map((x) => ({
                    questionId: x.id,
                    answer: answers[x.id] ?? '',
                  })),
                );
              }}
            >
              提交
            </button>
          ) : (
            <button
              type="button"
              className={btn.secondary}
              onClick={() => setIndex(index + 1)}
            >
              下一道
            </button>
          )}
        </div>
      }
    >
      <div key={q.id} className="mx-auto max-w-4xl space-y-4">
        <QuestionCard
          key={q.id}
          question={q}
          value={answers[q.id] ?? ''}
          onChange={(v) => setAnswers({ ...answers, [q.id]: v })}
        />
        {props.error && (
          <div className="mt-3">
            <Note tone="error">{props.error}</Note>
          </div>
        )}
      </div>
    </Page>
  );
}

function Revising(props: {
  session: PracticeSession;
  wrongIds: string[];
  onDone: () => void;
}) {
  const questions = props.session.questions.filter((x) =>
    props.wrongIds.includes(x.id),
  );
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState('');
  const [feedback, setFeedback] = useState<ReviseResult | null>(null);
  const [hint, setHint] = useState<PracticeHint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const q = questions[index];
  const last = index === questions.length - 1;
  const settled = feedback?.correctAnswer != null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch {
      setError('暂时无法处理，请再试一次。');
    } finally {
      setBusy(false);
    }
  };

  const check = (giveUp = false) =>
    run(async () => {
      const res = await window.api.revisePractice({
        questionId: q.id,
        answer: value,
        giveUp,
      });
      if (res.ok) setFeedback(res.value);
      else setError(res.error);
    });

  const requestHint = () =>
    run(async () => {
      const res = await window.api.requestPracticeHint({
        questionId: q.id,
        step: hint ? 2 : 1,
      });
      if (res.ok) setHint(res.value);
      else setError(res.error);
    });

  const next = () => {
    if (last) return props.onDone();
    setIndex(index + 1);
    setValue('');
    setFeedback(null);
    setHint(null);
    setError('');
  };

  return (
    <Page
      title="修改错题"
      scrollKey={q.id}
      description="再试一次，弄明白比做得快更重要。"
      headerExtra={
        <span className="shrink-0 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-mint">
          {index + 1} / {questions.length}
        </span>
      }
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            className={`${btn.secondary} mr-auto`}
            disabled={busy}
            onClick={props.onDone}
          >
            结束练习
          </button>
          {settled ? (
            <button type="button" className={btn.primary} onClick={next}>
              {last ? '完成' : '下一道'}
            </button>
          ) : (
            <>
              {hint?.step !== 2 && (
                <button
                  type="button"
                  className={btn.secondary}
                  disabled={busy}
                  onClick={() => void requestHint()}
                >
                  {hint ? '再给一点提示' : '给我一点提示'}
                </button>
              )}
              <button
                type="button"
                className={btn.secondary}
                disabled={busy}
                onClick={() => void check(true)}
              >
                看解析
              </button>
              <button
                type="button"
                className={btn.primary}
                disabled={busy || !value.trim()}
                onClick={() => void check()}
              >
                检查
              </button>
            </>
          )}
        </div>
      }
    >
      <div key={q.id} className="mx-auto max-w-4xl space-y-4">
        <QuestionCard
          key={q.id}
          question={q}
          value={value}
          disabled={settled || busy}
          onChange={(v) => {
            setValue(v);
            setFeedback(null);
          }}
        />
        <div
          role="status"
          className={
            hint && !settled ? 'rounded-2xl bg-white/10 p-4' : 'sr-only'
          }
        >
          {hint && !settled && (
            <>
              <p className="text-sm font-semibold text-mint">
                提示 {hint.step} / 2
              </p>
              <p className="mt-1 text-sm leading-relaxed text-white">
                {hint.prompt}
              </p>
            </>
          )}
        </div>
        {feedback && !feedback.correct && !settled && (
          <Note tone="error">
            {hint?.step === 2
              ? '还不对。可以再试一次，或看解析。'
              : '还不对。可以再试一次，或用一个提示想想。'}
          </Note>
        )}
        {feedback?.correct && (
          <Note tone="ok">答对了！试着用自己的话说说：你刚才改了哪一步？</Note>
        )}
        {settled && (
          <div className="rounded-2xl bg-white/10 p-4 text-white ring-1 ring-white/20">
            <p className="font-semibold">
              正确答案:
              <span className="font-mono">{feedback!.correctAnswer}</span>
              {q.answerType === 'number' && q.unit ? ` ${q.unit}` : ''}
            </p>
            {feedback!.solutionMarkdown && (
              <div className="mt-2 text-sm text-white/80">
                <MarkdownView>{feedback!.solutionMarkdown}</MarkdownView>
              </div>
            )}
          </div>
        )}
        {error && <Note tone="error">{error}</Note>}
      </div>
    </Page>
  );
}
