import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { FigureView } from '../components/FigureView';
import { Hero } from '../components/Hero';
import { MarkdownView } from '../components/MarkdownView';
import { PracticeQuestionReport } from '../components/PracticeQuestionReport';
import { Note, Page, Waiting, btn } from '../components/ui';
import { APP_DISPLAY_NAME } from '../shared/app-info';
import type {
  PracticeAnswerInput,
  PracticeDisposition,
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
  | { name: 'result'; session: PracticeSession; result: PracticeResult }
  | {
      name: 'revising';
      session: PracticeSession;
      result: PracticeResult;
      revisionMode: 'mistakes' | 'skipped';
    };

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

export function PracticePage({ active }: { active: boolean }) {
  const [stage, setStage] = useState<Stage>({ name: 'home' });
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [error, setError] = useState('');
  const statsDate = useRef('');
  const resultSessionId =
    stage.name === 'result' || stage.name === 'revising'
      ? stage.session.sessionId
      : null;

  useEffect(() => {
    if (!active || stage.name !== 'home') return;
    let current = true;
    let request = 0;
    const refresh = () => {
      const version = ++request;
      void window.api
        .getHomeStats()
        .then((value) => {
          if (current && version === request) {
            statsDate.current = value.dailyPractice.date;
            setStats(value);
            setError((previous) =>
              previous === '暂时无法读取练习信息。' ? '' : previous,
            );
          }
        })
        .catch(() => {
          if (current && version === request)
            setError('暂时无法读取练习信息。');
        });
    };
    refresh();
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(() => {
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      if (statsDate.current !== date) refresh();
    }, 15_000);
    return () => {
      current = false;
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, [active, stage.name]);

  useEffect(() => {
    if (!active || !resultSessionId) return;
    let current = true;
    void window.api
      .getPracticeResult({ sessionId: resultSessionId })
      .then((response) => {
        if (!current) return;
        if (!response.ok) return setError(response.error);
        setError('');
        setStage((latest) =>
          (latest.name === 'result' || latest.name === 'revising') &&
          latest.session.sessionId === resultSessionId
            ? { ...latest, result: response.value }
            : latest,
        );
      })
      .catch(() => {
        if (current) setError('暂时无法刷新练习结果。');
      });
    return () => {
      current = false;
    };
  }, [active, resultSessionId]);

  const start = async () => {
    setError('');
    setStage({ name: 'generating' });
    try {
      const res = await window.api.startPractice();
      if (!res.ok) {
        setError(res.error);
        return setStage({ name: 'home' });
      }
      setStage({ name: 'answering', session: res.value });
    } catch {
      setError('暂时无法开始练习，请重试。');
      setStage({ name: 'home' });
    }
  };

  const returnHome = () => {
    setStats(null);
    setError('');
    setStage({ name: 'home' });
  };

  if (stage.name === 'generating')
    return (
      <Waiting
        fill
        title="正在为你出题…"
        hint="每道题都会再算一遍确认答案没错,大约需要半分钟。"
      />
    );
  if (stage.name === 'answering')
    return (
      <Answering
        key={stage.session.sessionId}
        active={active}
        session={stage.session}
        onPause={returnHome}
        onAbandon={async () => {
          setError('');
          try {
            const res = await window.api.abandonPractice({
              sessionId: stage.session.sessionId,
            });
            if (!res.ok) return setError(res.error);
            clearPracticeDraft();
            returnHome();
          } catch {
            setError('暂时无法放弃练习，请重试。');
          }
        }}
        onSubmit={async (answers, elapsedMs) => {
          setError('');
          try {
            const res = await window.api.submitPractice({
              sessionId: stage.session.sessionId,
              answers,
              elapsedMs,
            });
            if (!res.ok) return setError(res.error);
            clearPracticeDraft();
            setStage({
              name: 'result',
              session: stage.session,
              result: res.value,
            });
          } catch {
            setError('暂时无法提交，已保留当前作答，请重试。');
          }
        }}
        error={error}
      />
    );

  if (stage.name === 'result' || stage.name === 'revising') {
    const result = stage.result;
    const revisionIds = [
      ...result.wrongQuestionIds,
      ...result.unsureQuestionIds,
    ];
    const beginRevision = (revisionMode: 'mistakes' | 'skipped') =>
      setStage({ ...stage, name: 'revising', revisionMode });
    if (stage.name === 'revising') {
      const ids = (
        stage.revisionMode === 'skipped'
          ? result.skippedQuestionIds
          : revisionIds
      ).filter((id) =>
        stage.session.questions.some((question) => question.id === id),
      );
      if (ids.length)
        return (
          <Revising
            key={ids.join(':')}
            session={stage.session}
            questionIds={ids}
            onDone={() =>
              setStage({ name: 'result', session: stage.session, result })
            }
          />
        );
    }
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
                try {
                  const res = await window.api.finishPractice({
                    sessionId: stage.session.sessionId,
                  });
                  if (!res.ok) return setError(res.error);
                  returnHome();
                } catch {
                  setError('暂时无法结束练习，请重试。');
                }
              }}
            >
              结束练习
            </button>
            {result.skippedQuestionIds.length > 0 && (
              <button
                type="button"
                className={btn.secondary}
                onClick={() => beginRevision('skipped')}
              >
                重做未作答
              </button>
            )}
            {revisionIds.length > 0 && (
              <button
                type="button"
                className={btn.primary}
                onClick={() => beginRevision('mistakes')}
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
            {result.correctCount > 0 &&
            !(
              result.wrongCount +
              result.unsureCount +
              result.skippedCount +
              result.invalidCount +
              result.unknownCount
            )
              ? '全部答对，继续保持！'
              : '看看这一轮的作答结果。'}
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {[
              {
                label: '答对',
                count: result.correctCount,
                style: 'bg-mint/10 text-mint',
              },
              {
                label: '答错',
                count: result.wrongCount,
                style: 'bg-sun/10 text-sun',
              },
              {
                label: '不会',
                count: result.unsureCount,
                style: 'bg-white/5 text-white',
              },
              {
                label: '未作答',
                count: result.skippedCount,
                style: 'bg-white/5 text-white',
              },
            ].map(({ label, count, style }) => (
              <div key={label} className={`rounded-2xl p-4 ${style}`}>
                <p className="text-sm text-white/70">{label}</p>
                <p className="mt-1 text-3xl font-semibold">
                  {count}
                  <span className="ml-2 text-sm font-normal">道</span>
                </p>
              </div>
            ))}
          </div>
          {result.invalidCount > 0 && (
            <div className="mt-4 text-sm text-white/70">
              <p>另有 {result.invalidCount} 道已作废，不计入结果。</p>
              <ul className="mt-1 space-y-1">
                {result.invalidQuestions.map((item) => (
                  <li
                    className="[overflow-wrap:anywhere]"
                    key={item.questionId}
                  >
                    第 {item.position + 1} 题：{item.reason || '复核确认有误'}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.unknownCount > 0 && (
            <p className="mt-4 text-sm text-white/70">
              另有 {result.unknownCount} 道历史作答状态不明，不计入掌握度。
            </p>
          )}
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            未作答不扣减掌握度。标记不会的内容以后会再练。
          </p>
          {error && <Note tone="error">{error}</Note>}
        </section>
      </Page>
    );
  }

  const plan = stats?.dailyPractice.plan;
  const canResume = stats?.dailyPractice.canResume ?? false;
  const canStart =
    canResume ||
    !!(plan && plan.review + plan.recheck + plan.reinforcement > 0);
  return (
    <Page
      title="智能练习"
      description={APP_DISPLAY_NAME}
      footer={
        <div className="flex items-center justify-between gap-5">
          <div className="min-w-0 text-sm text-white/60">
            {error ? (
              <Note tone="error">{error}</Note>
            ) : !stats ? (
              <p>正在读取练习信息…</p>
            ) : !canStart ? (
              <p>
                {stats.mistakeCount === 0
                  ? '先上传并确认错题，就可以开始练习。'
                  : '暂时没有需要练习的内容。'}
              </p>
            ) : canResume ? (
              <p>有一组练习还没结束，可以接着做。</p>
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
            {canResume ? '继续练习' : '开始练习'}
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
            className="grid auto-rows-fr grid-cols-2 gap-x-3 gap-y-5 @min-[640px]:grid-cols-4"
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
                hint: '自己完成的练习',
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
                className="rounded-3xl bg-white/5 px-4 py-3 ring-1 ring-inset ring-white/10"
              >
                <p className="text-sm text-white/60">{item.label}</p>
                <p className="mt-1 text-3xl font-semibold text-mint">
                  {item.value}
                  <span className="ml-2 text-xs font-normal text-white/50">
                    {item.unit}
                  </span>
                </p>
                <p className="mt-1 text-xs text-white/45">{item.hint}</p>
              </div>
            ))}
          </section>
        )}
      </div>
    </Page>
  );
}

const PRACTICE_DRAFT_KEY = 'zero-defect.practice-draft';
const MAX_PRACTICE_ELAPSED_MS = 86_400_000;
type DraftAnswers = Record<string, Omit<PracticeAnswerInput, 'questionId'>>;
type PracticeDraft = {
  questionId?: string;
  answers: DraftAnswers;
  elapsedMs: number;
};

function readPracticeDraft(sessionId: string): PracticeDraft {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(PRACTICE_DRAFT_KEY) ?? 'null',
    ) as (Partial<PracticeDraft> & { sessionId: string }) | null;
    if (stored?.sessionId === sessionId) {
      const elapsedMs = stored.elapsedMs ?? 0;
      return {
        questionId: stored.questionId,
        answers: stored.answers ?? {},
        elapsedMs: Number.isFinite(elapsedMs)
          ? Math.min(MAX_PRACTICE_ELAPSED_MS, Math.max(0, elapsedMs))
          : 0,
      };
    }
  } catch {
    return { answers: {}, elapsedMs: 0 };
  }
  return { answers: {}, elapsedMs: 0 };
}

function writePracticeDraft(sessionId: string, draft: PracticeDraft) {
  try {
    window.localStorage.setItem(
      PRACTICE_DRAFT_KEY,
      JSON.stringify({ sessionId, ...draft }),
    );
  } catch {
    return;
  }
}

function clearPracticeDraft() {
  try {
    window.localStorage.removeItem(PRACTICE_DRAFT_KEY);
  } catch {
    return;
  }
}

type PracticeConfirmation =
  | { action: 'abandon' }
  | { action: 'submit'; blank: number };

function PracticeConfirmDialog({
  confirmation,
  onCancel,
  onConfirm,
}: {
  confirmation: PracticeConfirmation;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const abandoning = confirmation.action === 'abandon';

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="m-auto w-md max-w-[calc(100%-2rem)] rounded-3xl bg-[#164d3b] p-6 text-white shadow-xl backdrop:bg-black/55"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id={titleId} className="text-xl font-semibold">
        {abandoning ? '放弃这组练习？' : '还有题目未作答'}
      </h2>
      <p
        id={descriptionId}
        className="mt-2 text-sm leading-relaxed text-white/80"
      >
        {confirmation.action === 'abandon'
          ? '本轮未提交的作答不会计分，到期项目仍会保留。'
          : `还有 ${confirmation.blank} 道题留空，提交后记为未作答，不算错。`}
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button
          ref={cancelRef}
          type="button"
          className={btn.secondary}
          onClick={onCancel}
        >
          继续作答
        </button>
        <button
          type="button"
          className={abandoning ? btn.danger : btn.primary}
          onClick={onConfirm}
        >
          {abandoning ? '确认放弃' : '确认提交'}
        </button>
      </div>
    </dialog>
  );
}

function Answering(props: {
  active: boolean;
  session: PracticeSession;
  error: string;
  onSubmit: (
    answers: PracticeAnswerInput[],
    elapsedMs: number,
  ) => Promise<void>;
  onAbandon: () => Promise<void>;
  onPause: () => void;
}) {
  const { questions, sessionId } = props.session;
  const [draft] = useState(() => readPracticeDraft(sessionId));
  const clock = useRef({
    elapsedMs: draft.elapsedMs,
    startedAt: null as number | null,
  });
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      questions.findIndex((question) => question.id === draft.questionId),
    ),
  );
  const [answers, setAnswers] = useState(draft.answers);
  const [confirmation, setConfirmation] = useState<PracticeConfirmation | null>(
    null,
  );
  const [pending, setPending] = useState<PracticeConfirmation['action'] | null>(
    null,
  );
  const busy = pending !== null;
  const q = questions[index];
  const last = index === questions.length - 1;
  const current = answers[q.id];
  const saveDraft = useCallback(
    (stopClock = false) => {
      const { startedAt, elapsedMs: previous } = clock.current;
      const elapsedMs = Math.min(
        MAX_PRACTICE_ELAPSED_MS,
        previous + (startedAt === null ? 0 : performance.now() - startedAt),
      );
      if (stopClock) clock.current = { elapsedMs, startedAt: null };
      writePracticeDraft(sessionId, { questionId: q.id, answers, elapsedMs });
      return elapsedMs;
    },
    [sessionId, q.id, answers],
  );
  useLayoutEffect(() => {
    const syncClock = () => {
      const running = props.active && !busy && !document.hidden;
      if (running) clock.current.startedAt ??= performance.now();
      saveDraft(!running);
    };
    const onPageHide = () => saveDraft(true);
    syncClock();
    document.addEventListener('visibilitychange', syncClock);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', syncClock);
    return () => {
      document.removeEventListener('visibilitychange', syncClock);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', syncClock);
    };
  }, [props.active, busy, saveDraft]);
  const mark = (disposition: PracticeDisposition) =>
    setAnswers((previous) => ({
      ...previous,
      [q.id]: {
        answer: '',
        disposition:
          previous[q.id]?.disposition === disposition ? undefined : disposition,
      },
    }));

  const run = async (action: PracticeConfirmation['action']) => {
    if (busy) return;
    setConfirmation(null);
    setPending(action);
    try {
      if (action === 'abandon') {
        await props.onAbandon();
      } else {
        await props.onSubmit(
          questions.map(({ id }) => ({
            questionId: id,
            ...(answers[id] ?? { answer: '' }),
          })),
          Math.round(saveDraft()),
        );
      }
    } finally {
      setPending(null);
    }
  };

  const submit = () => {
    const blank = questions.filter(
      ({ id }) => !answers[id]?.disposition && !answers[id]?.answer.trim(),
    ).length;
    if (blank > 0) setConfirmation({ action: 'submit', blank });
    else void run('submit');
  };

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
          {props.error && (
            <div className="w-full">
              <Note tone="error">{props.error}</Note>
            </div>
          )}
          <div className="mr-auto flex flex-wrap gap-3">
            <button
              type="button"
              className={btn.secondary}
              disabled={busy}
              onClick={() => {
                saveDraft(true);
                props.onPause();
              }}
            >
              稍后继续
            </button>
            <button
              type="button"
              className={btn.danger}
              disabled={busy}
              onClick={() => setConfirmation({ action: 'abandon' })}
            >
              {pending === 'abandon' ? '放弃中…' : '放弃练习'}
            </button>
          </div>
          <button
            type="button"
            className={btn.secondary}
            disabled={busy || index === 0}
            onClick={() => setIndex(index - 1)}
          >
            上一道
          </button>
          {last ? (
            <button
              type="button"
              className={btn.primary}
              disabled={busy}
              onClick={submit}
            >
              {pending === 'submit' ? '提交中…' : '提交'}
            </button>
          ) : (
            <button
              type="button"
              className={btn.secondary}
              disabled={busy}
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
          value={current?.answer ?? ''}
          disabled={busy}
          onChange={(answer) =>
            setAnswers((previous) => ({ ...previous, [q.id]: { answer } }))
          }
        />
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="作答状态"
        >
          {(
            [
              { disposition: 'unsure', label: '这题不会' },
              { disposition: 'skipped', label: '跳过这题' },
            ] as const
          ).map(({ disposition, label }) => (
            <button
              type="button"
              key={disposition}
              className={`${btn.small} aria-pressed:bg-mint/20 aria-pressed:text-mint`}
              aria-pressed={current?.disposition === disposition}
              disabled={busy}
              onClick={() => mark(disposition)}
            >
              {label}
            </button>
          ))}
        </div>
        {current?.disposition && (
          <Note tone="info">
            {current.disposition === 'unsure'
              ? '已标记为不会，后续会再练。'
              : '已标记为跳过，不计入对错。'}{' '}
            输入答案可修改标记。
          </Note>
        )}
        <PracticeQuestionReport questionId={q.id} />
      </div>
      {confirmation && (
        <PracticeConfirmDialog
          confirmation={confirmation}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => void run(confirmation.action)}
        />
      )}
    </Page>
  );
}

function Revising(props: {
  session: PracticeSession;
  questionIds: string[];
  onDone: () => void;
}) {
  const questions = props.session.questions.filter((x) =>
    props.questionIds.includes(x.id),
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
            返回练习结果
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
        <PracticeQuestionReport questionId={q.id} />
        {error && <Note tone="error">{error}</Note>}
      </div>
    </Page>
  );
}
