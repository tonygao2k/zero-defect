import { useEffect, useRef, useState } from 'react';
import { Hero } from '../components/Hero';
import { MarkdownView } from '../components/MarkdownView';
import { Note, Waiting, btn } from '../components/ui';
import { APP_DISPLAY_NAME } from '../shared/app-info';
import type {
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
    <div className="rounded-3xl bg-white p-8 text-ink shadow-lg">
      <div className="text-xl leading-relaxed">
        <MarkdownView>{q.questionMarkdown}</MarkdownView>
      </div>
      {q.answerType === 'choice' ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2" role="radiogroup">
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
        <label className="mt-6 flex items-center gap-3 text-lg">
          <span className="font-semibold">答案:</span>
          <input
            value={props.value}
            disabled={props.disabled}
            onChange={(e) => props.onChange(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            maxLength={40}
            className="h-12 w-56 rounded-2xl bg-slate-50 px-4 text-ink outline-none ring-2 ring-slate-200 focus:ring-emerald-500 font-mono"
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
      <div className="grid h-full place-items-center px-12">
        <div className="max-w-xl space-y-6">
          <h1 className="text-4xl font-semibold">已经提交!</h1>
          <p className="text-xl">
            正确 {stage.result.correctCount} 道题,错误 {stage.result.wrongCount}{' '}
            道题
          </p>
          <div className="flex flex-wrap gap-4">
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
          </div>
          {stage.result.wrongCount > 0 && (
            <p className="text-sm text-white/60">
              不会做也可以直接结束,这些知识点会记下来,之后还会再练。
            </p>
          )}
        </div>
      </div>
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
    <div className="flex h-full flex-col">
      <div className="flex flex-1 items-center justify-center gap-10 overflow-y-auto px-10">
        <Hero />
        <div className="max-w-md">
          <h1 className="text-5xl font-semibold tracking-wide">智能练习</h1>
          <p className="mt-2 text-sm text-white/60">{APP_DISPLAY_NAME}</p>
          {stats && (
            <ul className="mt-6 space-y-3 text-base text-white/85">
              <li>
                错题库规模:{stats.mistakeCount} 道题,{stats.knowledgePointCount}{' '}
                个知识点
              </li>
              <li>
                已经完成 {stats.answeredCount} 道练习题,已经掌握{' '}
                {stats.masteredKnowledgePoints} 个知识点
              </li>
              <li>还剩 {stats.remainingKnowledgePoints} 个知识点未掌握</li>
            </ul>
          )}
        </div>
      </div>
      <div className="flex flex-col items-center gap-3 pb-8">
        {error && <Note tone="error">{error}</Note>}
        {stats && !canStart && !error && (
          <Note tone="info">
            {stats.mistakeCount === 0
              ? '错题库里还没有已确认的错题,先去上传并确认吧。'
              : '现在没有需要练习的内容,已掌握的知识点到时间会提醒复习。'}
          </Note>
        )}
        <button
          type="button"
          onClick={start}
          disabled={!canStart}
          className="start-btn grid h-28 w-28 place-items-center rounded-full bg-gradient-to-b from-[#b6ffd8] to-[#22c97a] text-xl font-bold text-ink ring-4 ring-white/70 transition active:scale-95 disabled:opacity-40 disabled:[animation:none]"
        >
          开始练习
        </button>
      </div>
    </div>
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
    <div className="flex h-full flex-col px-12 pb-8 pt-16">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">练习题</h1>
        <span className="text-xl font-semibold text-mint">
          {index + 1}/{questions.length}
        </span>
      </div>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <QuestionCard
          key={q.id}
          question={q}
          value={answers[q.id] ?? ''}
          onChange={(v) => setAnswers({ ...answers, [q.id]: v })}
        />
      </div>
      {props.error && (
        <div className="mt-3">
          <Note tone="error">{props.error}</Note>
        </div>
      )}
      <div className="mt-4 flex justify-center gap-6">
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
    </div>
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
  const [error, setError] = useState('');
  const q = questions[index];
  const last = index === questions.length - 1;
  const settled = feedback?.correctAnswer != null;

  const check = async (giveUp = false) => {
    setError('');
    const res = await window.api.revisePractice({
      questionId: q.id,
      answer: value,
      giveUp,
    });
    if (!res.ok) return setError(res.error);
    setFeedback(res.value);
  };

  const next = () => {
    if (last) return props.onDone();
    setIndex(index + 1);
    setValue('');
    setFeedback(null);
  };

  return (
    <div className="flex h-full flex-col px-12 pb-8 pt-16">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">修改错题</h1>
        <span className="text-xl font-semibold text-mint">
          {index + 1}/{questions.length}
        </span>
      </div>
      <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto">
        <QuestionCard
          key={q.id}
          question={q}
          value={value}
          disabled={settled}
          onChange={(v) => {
            setValue(v);
            setFeedback(null);
          }}
        />
        {feedback && !feedback.correct && !settled && (
          <Note tone="error">
            还不对,再想想。实在不会可以点「不会做」看答案。
          </Note>
        )}
        {feedback?.correct && <Note tone="ok">答对了!</Note>}
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
      <div className="mt-4 flex justify-center gap-6">
        {settled ? (
          <button type="button" className={btn.primary} onClick={next}>
            {last ? '完成' : '下一道'}
          </button>
        ) : (
          <>
            <button
              type="button"
              className={btn.primary}
              disabled={!value.trim()}
              onClick={() => check()}
            >
              检查
            </button>
            <button
              type="button"
              className={btn.secondary}
              onClick={() => check(true)}
            >
              不会做
            </button>
          </>
        )}
        <button type="button" className={btn.secondary} onClick={props.onDone}>
          结束练习
        </button>
      </div>
    </div>
  );
}
