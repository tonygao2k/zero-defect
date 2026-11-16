import { useEffect, useRef, type ReactNode } from 'react';

/** 全局统一的按钮样式。 */
export const btn = {
  primary:
    'h-12 shrink-0 whitespace-nowrap rounded-full bg-gradient-to-b from-[#b6ffd8] to-[#22c97a] px-8 text-base font-bold text-ink transition active:scale-95 disabled:opacity-50 disabled:active:scale-100',
  secondary:
    'h-12 shrink-0 whitespace-nowrap rounded-full bg-white/15 px-6 text-base font-semibold ring-1 ring-white/30 transition hover:bg-white/25 disabled:opacity-50',
  danger:
    'h-12 shrink-0 whitespace-nowrap rounded-full bg-white/10 px-6 text-base font-semibold text-sun ring-1 ring-sun/50 transition hover:bg-sun/15 disabled:opacity-50',
  small:
    'h-9 shrink-0 whitespace-nowrap rounded-full bg-white/15 px-4 text-sm font-semibold ring-1 ring-white/30 transition hover:bg-white/25 disabled:opacity-50',
} as const;

export const inputClass =
  'h-12 w-full rounded-2xl bg-black/20 px-4 text-white outline-none ring-1 ring-white/20 placeholder:text-white/40 focus:ring-2 focus:ring-mint';

/** 全局统一的等待样式:识别、出题等所有需要等待的地方都用它。 */
export function Waiting(props: {
  title: string;
  hint?: string;
  /** 占满整个区域并居中;否则只是行内的一小块。 */
  fill?: boolean;
}) {
  const body = (
    <div role="status" className="flex flex-col items-center gap-4 text-center">
      <span
        aria-hidden="true"
        className="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-mint"
      />
      <p className="text-lg font-semibold text-mint">{props.title}</p>
      {props.hint && <p className="text-sm text-white/60">{props.hint}</p>}
    </div>
  );
  return props.fill ? (
    <div className="grid h-full place-items-center">{body}</div>
  ) : (
    body
  );
}

type Tone = 'ok' | 'error' | 'info';
const toneClass: Record<Tone, string> = {
  ok: 'text-mint',
  error: 'text-sun',
  info: 'text-white/75',
};

/** 成功、失败、提示信息的统一展示。错误用 role=alert,其余用 role=status。 */
export function Note(props: { tone: Tone; children: ReactNode }) {
  return (
    <p
      role={props.tone === 'error' ? 'alert' : 'status'}
      className={`text-sm ${toneClass[props.tone]}`}
    >
      {props.children}
    </p>
  );
}

/** 页面外壳:标题、单一内容滚动区，以及始终可见的底部操作。 */
export function Page(props: {
  title: string;
  children: ReactNode;
  description?: string;
  headerExtra?: ReactNode;
  footer?: ReactNode;
  scrollKey?: string | number;
  /** 内容自己决定如何滚动(整页不滚动),用于需要固定布局的详情页。 */
  fixed?: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [props.title, props.scrollKey]);

  return (
    <div className="flex h-full flex-col px-12 pb-8 pt-16">
      <header className="flex shrink-0 items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-4xl font-semibold">{props.title}</h1>
          {props.description && (
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              {props.description}
            </p>
          )}
        </div>
        {props.headerExtra}
      </header>
      <div
        ref={contentRef}
        className={`mt-6 min-h-0 flex-1 ${
          props.fixed
            ? 'flex flex-col overflow-hidden'
            : 'overflow-y-auto overscroll-contain p-1 pr-3'
        }`}
      >
        {props.children}
      </div>
      {props.footer && (
        <footer className="mt-4 shrink-0 border-t border-white/15 pt-4">
          {props.footer}
        </footer>
      )}
    </div>
  );
}

/** 图片工具栏等次要操作只显示图标，保留提示和键盘焦点。 */
export const iconBtn =
  'grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-white/75 ring-1 ring-inset ring-white/15 transition hover:bg-white/20 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint disabled:opacity-35';
