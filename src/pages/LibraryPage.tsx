import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmMistake } from '../components/ConfirmMistake';
import { MarkdownView } from '../components/MarkdownView';
import { PracticeReviewPage } from '../components/PracticeReviewPage';
import {
  BookIcon,
  ChevronDownIcon,
  EditIcon,
  TrashIcon,
} from '../components/Icons';
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
  reviewReasonLabels,
  type MistakeReviewReason,
  type MistakeSummary,
} from '../shared/mistakes';
import { PAPER_TITLE_MAX_LENGTH, type PaperSummary } from '../shared/papers';

type Filter = 'all' | 'pending' | 'confirmed';
type Msg = { tone: 'ok' | 'error' | 'info'; text: string } | null;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '待确认' },
  { id: 'confirmed', label: '已确认' },
];

export function LibraryPage() {
  const [papers, setPapers] = useState<PaperSummary[] | null>(null);
  const [allTerms, setAllTerms] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [mistakeData, setMistakeData] = useState<{
    paperId: string;
    items: MistakeSummary[];
  } | null>(null);
  const [loadError, setLoadError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const reload = useCallback(async () => {
    const list = await window.api.listPapers({ allTerms });
    setPapers(list);
    setSelected((cur) =>
      cur && list.some((p) => p.id === cur) ? cur : (list[0]?.id ?? null),
    );
  }, [allTerms]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 有试卷还在识别时,隔几秒刷新一次。
  useEffect(() => {
    if (!papers?.some((p) => p.status === 'processing')) return;
    const timer = setTimeout(() => void reload(), 2500);
    return () => clearTimeout(timer);
  }, [papers, reload]);

  const paper = papers?.find((p) => p.id === selected) ?? null;

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoadError('');
    void window.api
      .listMistakes({ paperId: selected })
      .then((items) => {
        if (!cancelled) setMistakeData({ paperId: selected, items });
      })
      .catch(() => {
        if (!cancelled) setLoadError('错题加载失败，请重新选择试卷后重试。');
      });
    return () => {
      cancelled = true;
    };
  }, [selected, papers]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [selected, filter, detailId]);

  const allMistakes =
    mistakeData?.paperId === selected ? mistakeData.items : [];
  const loadingMistakes =
    selected !== null && mistakeData?.paperId !== selected;
  const counts = {
    all: allMistakes.length,
    pending: allMistakes.filter(
      (m) => m.status === 'draft' || m.status === 'unattributed',
    ).length,
    confirmed: allMistakes.filter((m) => m.status === 'active').length,
  };
  const mistakes = allMistakes.filter(
    (m) =>
      filter === 'all' ||
      (filter === 'confirmed'
        ? m.status === 'active'
        : m.status === 'draft' || m.status === 'unattributed'),
  );

  const run = async (
    action: () => Promise<{ ok: boolean; error?: string }>,
    okText: string,
  ) => {
    setBusy(true);
    setMsg(null);
    const res = await action();
    setBusy(false);
    setMsg(
      res.ok
        ? { tone: 'ok', text: okText }
        : { tone: 'error', text: res.error ?? '操作失败' },
    );
    await reload();
  };

  if (reviewOpen)
    return <PracticeReviewPage onBack={() => setReviewOpen(false)} />;

  if (detailId) {
    return (
      <Page title="错题库" fixed>
        {msg && (
          <div className="mb-4 shrink-0">
            <Note tone={msg.tone}>{msg.text}</Note>
          </div>
        )}
        <ConfirmMistake
          key={detailId}
          mistakeId={detailId}
          onBack={() => setDetailId(null)}
          onDone={(text) => {
            setDetailId(null);
            setMsg({ tone: 'ok', text });
            void reload();
          }}
        />
      </Page>
    );
  }

  if (papers === null)
    return (
      <Page title="错题库">
        <Waiting title="加载中…" fill />
      </Page>
    );

  /** 列表上的“确认”:直接采用 AI 推荐的结果;信息不够时才打开详情页。 */
  const quickConfirm = async (id: string) => {
    setBusy(true);
    setMsg(null);
    const res = await window.api.confirmRecommended({ mistakeId: id });
    setBusy(false);
    if (!res.ok) {
      setMsg({ tone: 'error', text: res.error });
    } else if (res.value.confirmed) {
      setMsg({ tone: 'ok', text: '已确认' });
    } else {
      setMsg({
        tone: 'info',
        text: `需要逐题核对：${res.value.reasons.map((reason) => reviewReasonLabels[reason]).join('、')}。`,
      });
      setDetailId(id);
    }
    await reload();
  };

  const confirmAll = async () => {
    if (!paper) return;
    setBusy(true);
    setMsg(null);
    const res = await window.api.confirmPaper({ paperId: paper.id });
    setBusy(false);
    if (!res.ok) setMsg({ tone: 'error', text: res.error });
    else {
      const { confirmed, skipped, skippedReasons } = res.value;
      const reasons = (Object.keys(reviewReasonLabels) as MistakeReviewReason[])
        .filter((reason) => skippedReasons[reason])
        .map(
          (reason) =>
            `${reviewReasonLabels[reason]} ${skippedReasons[reason]} 道`,
        )
        .join('、');
      setMsg({
        tone: 'ok',
        text:
          skipped > 0
            ? `已确认 ${confirmed} 道；另有 ${skipped} 道需要逐题核对。原因（同一题可能有多项）：${reasons}。`
            : `已确认 ${confirmed} 道。`,
      });
    }
    await reload();
  };

  const selectPaper = (id: string) => {
    setSelected(id);
    setRenaming(null);
    setMsg(null);
  };

  return (
    <Page
      title="错题库"
      description="按试卷查看错题，核对答案与错误原因。"
      fixed
      headerExtra={
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button
            type="button"
            className={btn.small}
            onClick={() => setReviewOpen(true)}
          >
            练习题复核
          </button>
          <label className="relative flex shrink-0 items-center text-sm text-white/65">
            <span className="sr-only">学期范围</span>
            <select
              aria-label="学期范围"
              value={allTerms ? 'all' : 'current'}
              onChange={(e) => setAllTerms(e.target.value === 'all')}
              className="h-10 appearance-none rounded-full bg-white/10 px-4 pr-10 text-sm font-medium text-white/85 outline-none ring-1 ring-inset ring-white/15 transition hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-mint"
            >
              <option value="current" className="text-ink">
                当前学期
              </option>
              <option value="all" className="text-ink">
                全部学期
              </option>
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-3 h-4 w-4 text-white/60" />
          </label>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 gap-5 p-1">
        <aside
          aria-label="试卷目录"
          className="hidden w-56 shrink-0 flex-col rounded-3xl bg-white/5 ring-1 ring-inset ring-white/10 min-[1100px]:flex"
        >
          <div className="flex shrink-0 items-center justify-between px-4 pt-5 pb-3">
            <h2 className="text-sm font-semibold text-white/85">我的试卷</h2>
            <span className="text-xs text-white/45">{papers.length} 份</span>
          </div>
          <ScrollArea
            aria-label="试卷列表"
            className="min-h-0 flex-1"
            contentClassName="overflow-y-auto overscroll-contain px-2 pb-3"
          >
            <ul className="space-y-1.5">
              {papers.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => selectPaper(p.id)}
                    aria-current={p.id === selected ? 'true' : undefined}
                    className={`w-full rounded-2xl px-3 py-3 text-left outline-none ring-1 ring-inset transition focus-visible:ring-mint ${p.id === selected ? 'bg-mint/10 ring-mint/40' : 'ring-transparent hover:bg-white/5'}`}
                  >
                    <span
                      className={`line-clamp-2 text-sm leading-relaxed font-medium [overflow-wrap:anywhere] ${p.id === selected ? 'text-mint' : 'text-white/80'}`}
                    >
                      {p.title}
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/45">
                      {p.status === 'processing' ? (
                        <span className="text-mint/80">正在识别…</span>
                      ) : p.status === 'failed' ? (
                        <span className="text-sun">识别失败</span>
                      ) : (
                        <>
                          <span>{p.totalCount} 道错题</span>
                          {p.pendingCount > 0 && (
                            <span className="text-sun/85">
                              {p.pendingCount} 道待确认
                            </span>
                          )}
                        </>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {papers.length === 0 && (
              <p className="px-2 py-6 text-sm leading-relaxed text-white/45">
                上传试卷后，会在这里按试卷整理。
              </p>
            )}
          </ScrollArea>
        </aside>

        <section
          aria-label="试卷错题"
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {!paper ? (
            <div className="grid min-h-0 flex-1 place-items-center rounded-3xl bg-white/5 p-6 text-center ring-1 ring-inset ring-white/10">
              <div className="max-w-sm">
                <BookIcon className="mx-auto mb-4 h-10 w-10 text-mint/50" />
                <h2 className="font-semibold">还没有试卷</h2>
                <p className="mt-2 text-sm leading-relaxed text-white/50">
                  到「上传错题」添加试卷，识别后的错题会整理在这里。
                </p>
              </div>
            </div>
          ) : (
            <>
              <header className="shrink-0 rounded-3xl bg-white/5 p-5 ring-1 ring-inset ring-white/10">
                <div className="flex items-start justify-between gap-3">
                  {renaming === paper.id ? (
                    <Rename
                      key={paper.id}
                      initial={paper.title}
                      onCancel={() => setRenaming(null)}
                      onSave={(title) => {
                        setRenaming(null);
                        void run(
                          () =>
                            window.api.renamePaper({
                              paperId: paper.id,
                              title,
                            }),
                          '试卷已改名',
                        );
                      }}
                    />
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <h2
                          className="sr-only text-lg leading-snug font-semibold [overflow-wrap:anywhere] min-[1100px]:not-sr-only min-[1100px]:line-clamp-2"
                          title={paper.title}
                        >
                          {paper.title}
                        </h2>
                        <select
                          aria-label="选择试卷"
                          value={selected ?? ''}
                          onChange={(e) => selectPaper(e.target.value)}
                          className="h-9 w-full min-w-0 rounded-lg bg-transparent pr-2 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-mint min-[1100px]:hidden"
                        >
                          {papers.map((p) => (
                            <option
                              key={p.id}
                              value={p.id}
                              className="text-ink"
                            >
                              {p.title}
                            </option>
                          ))}
                        </select>
                        <p className="mt-2 text-xs leading-relaxed text-white/50">
                          {paper.status === 'done'
                            ? `共 ${paper.totalCount} 道错题${paper.pendingCount > 0 ? ` · ${paper.pendingCount} 道待确认` : ''}`
                            : paper.status === 'processing'
                              ? '正在识别这份试卷'
                              : '这份试卷尚未完成识别'}
                        </p>
                      </div>
                      <div
                        className="flex shrink-0 gap-2"
                        role="group"
                        aria-label="试卷操作"
                      >
                        <button
                          type="button"
                          aria-label="重命名试卷"
                          title="重命名试卷"
                          className={iconBtn}
                          disabled={busy}
                          onClick={() => setRenaming(paper.id)}
                        >
                          <EditIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="删除试卷"
                          title="删除整份试卷"
                          className={`${iconBtn} hover:!text-sun`}
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `删除试卷「${paper.title}」?它下面的所有错题和图片都会一起删除,不能恢复。`,
                              )
                            ) {
                              void run(
                                () =>
                                  window.api.deletePaper({ paperId: paper.id }),
                                '试卷已删除',
                              );
                            }
                          }}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </header>

              {paper.status === 'done' && (
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 py-4">
                  <div
                    role="group"
                    aria-label="错题状态"
                    className="flex gap-1 rounded-full bg-black/15 p-1 ring-1 ring-inset ring-white/10"
                  >
                    {FILTERS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        aria-pressed={filter === f.id}
                        onClick={() => setFilter(f.id)}
                        className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-mint ${filter === f.id ? 'bg-mint text-ink' : 'text-white/60 hover:bg-white/5 hover:text-white'}`}
                      >
                        {f.label}
                        <span
                          className={
                            filter === f.id ? 'text-ink/60' : 'text-white/40'
                          }
                        >
                          {loadingMistakes || loadError ? '…' : counts[f.id]}
                        </span>
                      </button>
                    ))}
                  </div>
                  {paper.pendingCount > 0 && (
                    <button
                      type="button"
                      className={btn.small}
                      disabled={busy || loadingMistakes || !!loadError}
                      onClick={confirmAll}
                    >
                      本卷全部确认
                    </button>
                  )}
                </div>
              )}

              {msg && (
                <div className="mb-3 shrink-0 rounded-xl bg-white/5 px-4 py-3">
                  <Note tone={msg.tone}>{msg.text}</Note>
                </div>
              )}

              <ScrollArea
                ref={listRef}
                role="region"
                aria-label="错题列表"
                aria-busy={
                  paper.status === 'done' && loadingMistakes && !loadError
                }
                tabIndex={0}
                className="min-h-0 flex-1 rounded-3xl bg-black/10 outline-none ring-1 ring-inset ring-white/10 focus-visible:ring-mint"
                contentClassName="overflow-y-auto overscroll-contain rounded-3xl p-1"
              >
                {paper.status === 'processing' ? (
                  <div className="flex min-h-full items-center justify-center p-6">
                    <Waiting
                      title="正在识别…"
                      hint="可以先去做别的，完成后这里会自动更新。"
                    />
                  </div>
                ) : paper.status === 'failed' ? (
                  <div className="flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center">
                    <p className="font-semibold">试卷识别失败</p>
                    <Note tone="error">{paper.errorMessage ?? '请重试'}</Note>
                    <button
                      type="button"
                      className={btn.secondary}
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => window.api.retryPaper({ paperId: paper.id }),
                          '已重新开始识别',
                        )
                      }
                    >
                      重新识别
                    </button>
                  </div>
                ) : loadError ? (
                  <div className="p-6">
                    <Note tone="error">{loadError}</Note>
                  </div>
                ) : loadingMistakes ? (
                  <Waiting title="加载错题中…" fill />
                ) : mistakes.length === 0 ? (
                  <div className="flex min-h-full flex-col items-center justify-center p-6 text-center">
                    <BookIcon className="mb-4 h-8 w-8 text-mint/45" />
                    <p className="text-sm font-medium text-white/80">
                      {paper.totalCount === 0
                        ? '这份试卷没有发现做错或没做的题'
                        : filter === 'pending'
                          ? '这份试卷的错题都已确认'
                          : filter === 'confirmed'
                            ? '还没有已确认的错题'
                            : '这里暂时没有错题'}
                    </p>
                    <p className="mt-2 text-xs text-white/45">
                      {filter === 'pending' && paper.totalCount > 0
                        ? '可以到「智能练习」继续巩固。'
                        : '切换筛选或试卷，查看其他错题。'}
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-white/10">
                    {mistakes.map((m) => (
                      <MistakeRow
                        key={m.id}
                        m={m}
                        busy={busy}
                        onOpen={() => setDetailId(m.id)}
                        onConfirm={() => void quickConfirm(m.id)}
                        onDelete={() => {
                          if (window.confirm('删除这道错题?删除后不能恢复。'))
                            void run(
                              () =>
                                window.api.deleteMistake({ mistakeId: m.id }),
                              '错题已删除',
                            );
                        }}
                      />
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </>
          )}
        </section>
      </div>
    </Page>
  );
}

function MistakeRow(props: {
  m: MistakeSummary;
  busy: boolean;
  onOpen: () => void;
  onConfirm: () => void;
  onDelete: () => void;
}) {
  const { m } = props;
  const confirmed = m.status === 'active';
  return (
    <li className="group flex items-center gap-3 rounded-2xl px-4 py-4 transition hover:bg-white/5 focus-within:bg-white/5">
      <button
        type="button"
        aria-label={`查看${m.label || '错题'}详情`}
        onClick={props.onOpen}
        className="min-w-0 flex-1 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-mint"
      >
        <span className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-mint">
            {m.label || '未标注题号'}
          </span>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[11px] ${confirmed ? 'bg-mint/10 text-mint/80' : 'bg-sun/10 text-sun/90'}`}
          >
            {confirmed
              ? '已确认'
              : m.status === 'archived'
                ? '已归档'
                : '待确认'}
          </span>
          {(m.incomplete || m.needsAttention) && (
            <span className="text-[11px] text-sun/80">
              {m.incomplete ? '题目不完整' : '需复核'}
            </span>
          )}
        </span>
        <span className="line-clamp-2 text-sm leading-6 text-white/90 [overflow-wrap:anywhere]">
          <MarkdownView inline>{m.questionMarkdown}</MarkdownView>
        </span>
        {(m.knowledgePointLabel || m.primaryRootCauseLabel) && (
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/45">
            {m.knowledgePointLabel && <span>{m.knowledgePointLabel}</span>}
            {m.primaryRootCauseLabel && (
              <span className="border-l border-white/15 pl-3">
                {m.primaryRootCauseLabel}
              </span>
            )}
          </span>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-2">
        {!confirmed && m.status !== 'archived' && (
          <button
            type="button"
            className={`${btn.small} !h-8 !px-3 !text-xs`}
            disabled={props.busy}
            onClick={m.needsAttention ? props.onOpen : props.onConfirm}
          >
            {m.needsAttention ? '复核' : '确认'}
          </button>
        )}
        <button
          type="button"
          aria-label={`删除${m.label || '错题'}`}
          title="删除这道错题"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/40 transition hover:bg-sun/10 hover:text-sun focus-visible:outline-2 focus-visible:outline-mint disabled:opacity-35"
          disabled={props.busy}
          onClick={props.onDelete}
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

function Rename(props: {
  initial: string;
  onSave: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(props.initial);
  return (
    <form
      className="flex w-full min-w-0 flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSave(value);
      }}
    >
      <input
        autoFocus
        aria-label="试卷名称"
        value={value}
        maxLength={PAPER_TITLE_MAX_LENGTH}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onCancel();
        }}
        className={`${inputClass} min-w-0 flex-1 !h-9 !rounded-xl !text-sm`}
      />
      <button type="submit" className={btn.small} disabled={!value.trim()}>
        保存
      </button>
      <button type="button" className={btn.small} onClick={props.onCancel}>
        取消
      </button>
    </form>
  );
}
