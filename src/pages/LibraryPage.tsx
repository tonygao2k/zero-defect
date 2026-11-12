import { useCallback, useEffect, useState } from 'react';
import { ConfirmMistake } from '../components/ConfirmMistake';
import { MarkdownView } from '../components/MarkdownView';
import { Note, Page, Waiting, btn, inputClass } from '../components/ui';
import type { MistakeSummary } from '../shared/mistakes';
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
  const [mistakes, setMistakes] = useState<MistakeSummary[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

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
    if (!selected) return setMistakes([]);
    void window.api
      .listMistakes({
        paperId: selected,
        status: filter === 'all' ? undefined : filter,
      })
      .then(setMistakes);
  }, [selected, filter, papers]);

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

  if (detailId) {
    return (
      <Page title="错题库">
        {msg && (
          <div className="mb-4">
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
        text: 'AI 没能确定这道题的原因或知识点,或题目不完整,请在详情里补充后再确认。',
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
      const { confirmed, skipped } = res.value;
      setMsg({
        tone: 'ok',
        text:
          skipped > 0
            ? `已确认 ${confirmed} 道;另有 ${skipped} 道需要你逐题核对(把握不高、知识点不明或题目不完整)。`
            : `已确认 ${confirmed} 道。`,
      });
    }
    await reload();
  };

  return (
    <Page title="错题库">
      <div className="grid h-full gap-6 lg:grid-cols-[minmax(0,280px)_1fr]">
        <aside className="flex min-h-0 flex-col rounded-3xl bg-white/10 p-3 ring-1 ring-white/15">
          <label className="mb-3 flex items-center gap-2 px-2 text-sm text-white/75">
            <input
              type="checkbox"
              checked={allTerms}
              onChange={(e) => setAllTerms(e.target.checked)}
            />
            显示全部学期
          </label>
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {papers.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-white/60">
                还没有标签。到「上传错题」添加试卷吧。
              </li>
            )}
            {papers.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(p.id);
                    setMsg(null);
                  }}
                  aria-current={p.id === selected ? 'true' : undefined}
                  className={`flex w-full items-center justify-between gap-2 rounded-2xl px-4 py-3 text-left ring-1 transition ${
                    p.id === selected
                      ? 'bg-white/20 ring-mint'
                      : 'bg-white/5 ring-white/15 hover:bg-white/10'
                  }`}
                >
                  <span className="truncate font-semibold">{p.title}</span>
                  {p.status === 'processing' ? (
                    <span className="shrink-0 text-xs text-white/70">
                      识别中
                    </span>
                  ) : p.status === 'failed' ? (
                    <span className="shrink-0 text-xs text-sun">失败</span>
                  ) : (
                    p.pendingCount > 0 && (
                      <span className="shrink-0 rounded-full bg-sun px-2 py-0.5 text-xs font-bold text-ink">
                        待确认 {p.pendingCount}
                      </span>
                    )
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="min-h-0 overflow-y-auto">
          {!paper ? (
            <p className="text-white/60">选择左边的标签查看错题。</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                {renaming === paper.id ? (
                  <Rename
                    initial={paper.title}
                    onCancel={() => setRenaming(null)}
                    onSave={(title) => {
                      setRenaming(null);
                      void run(
                        () =>
                          window.api.renamePaper({ paperId: paper.id, title }),
                        '已改名',
                      );
                    }}
                  />
                ) : (
                  <>
                    <h2 className="text-xl font-semibold">{paper.title}</h2>
                    <button
                      type="button"
                      className={btn.small}
                      onClick={() => setRenaming(paper.id)}
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      className={btn.small}
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `删除标签「${paper.title}」?它下面的所有错题和图片都会一起删除,不能恢复。`,
                          )
                        ) {
                          void run(
                            () => window.api.deletePaper({ paperId: paper.id }),
                            '已删除',
                          );
                        }
                      }}
                    >
                      删除标签
                    </button>
                  </>
                )}
              </div>

              {paper.status === 'processing' && (
                <div className="mt-6">
                  <Waiting
                    title="正在识别…"
                    hint="可以先去做别的,识别完成后这里会自动更新。"
                  />
                </div>
              )}

              {paper.status === 'failed' && (
                <div className="mt-6 space-y-3">
                  <Note tone="error">
                    识别失败:{paper.errorMessage ?? '请重试'}
                  </Note>
                  <button
                    type="button"
                    className={btn.primary}
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => window.api.retryPaper({ paperId: paper.id }),
                        '已重新开始识别',
                      )
                    }
                  >
                    重试
                  </button>
                </div>
              )}

              {paper.status === 'done' && (
                <>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <div role="tablist" className="flex gap-2">
                      {FILTERS.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          role="tab"
                          aria-selected={filter === f.id}
                          onClick={() => setFilter(f.id)}
                          className={`h-9 rounded-full px-4 text-sm font-semibold ring-1 transition ${
                            filter === f.id
                              ? 'bg-white/25 ring-mint'
                              : 'bg-white/10 ring-white/20 hover:bg-white/20'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                    {paper.pendingCount > 0 && (
                      <button
                        type="button"
                        className={btn.small}
                        disabled={busy}
                        onClick={confirmAll}
                      >
                        本卷全部确认
                      </button>
                    )}
                  </div>
                  {msg && (
                    <div className="mt-3">
                      <Note tone={msg.tone}>{msg.text}</Note>
                    </div>
                  )}

                  {mistakes.length === 0 ? (
                    <p className="mt-6 text-white/60">
                      {paper.totalCount === 0
                        ? '这份试卷没有发现做错或没做的题。'
                        : '这里没有符合条件的错题。'}
                    </p>
                  ) : (
                    <ul className="mt-4 space-y-2">
                      {mistakes.map((m) => (
                        <MistakeRow
                          key={m.id}
                          m={m}
                          busy={busy}
                          onOpen={() => setDetailId(m.id)}
                          onConfirm={() => void quickConfirm(m.id)}
                          onDelete={() => {
                            if (
                              window.confirm('删除这道错题?删除后不能恢复。')
                            ) {
                              void run(
                                () =>
                                  window.api.deleteMistake({ mistakeId: m.id }),
                                '已删除',
                              );
                            }
                          }}
                        />
                      ))}
                    </ul>
                  )}
                </>
              )}
              {paper.status !== 'done' && msg && (
                <div className="mt-3">
                  <Note tone={msg.tone}>{msg.text}</Note>
                </div>
              )}
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
    <li className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/15">
      <button
        type="button"
        onClick={props.onOpen}
        className="min-w-0 flex-1 text-left"
      >
        <span className="line-clamp-2 block break-words">
          <MarkdownView inline>{m.questionMarkdown}</MarkdownView>
        </span>
        <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-white/60">
          {m.knowledgePointLabel && <span>{m.knowledgePointLabel}</span>}
          {m.primaryRootCauseLabel && <span>{m.primaryRootCauseLabel}</span>}
          {m.incomplete && <span className="text-sun">题目不完整</span>}
          {m.needsAttention && !m.incomplete && (
            <span className="text-sun">请仔细核对</span>
          )}
        </span>
      </button>
      {confirmed ? (
        <span className="shrink-0 text-sm font-semibold text-mint">已确认</span>
      ) : (
        <button
          type="button"
          className={btn.small}
          disabled={props.busy}
          onClick={props.onConfirm}
        >
          确认
        </button>
      )}
      <button
        type="button"
        className={btn.small}
        disabled={props.busy}
        onClick={props.onDelete}
      >
        删除
      </button>
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
    <>
      <input
        autoFocus
        aria-label="标签名称"
        value={value}
        maxLength={PAPER_TITLE_MAX_LENGTH}
        onChange={(e) => setValue(e.target.value)}
        className={`${inputClass} !h-10 max-w-xs`}
      />
      <button
        type="button"
        className={btn.small}
        onClick={() => props.onSave(value)}
      >
        保存
      </button>
      <button type="button" className={btn.small} onClick={props.onCancel}>
        取消
      </button>
    </>
  );
}
