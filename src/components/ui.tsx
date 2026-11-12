import type { ReactNode } from 'react';

/** 全局统一的按钮样式。 */
export const btn = {
  primary:
    'h-12 rounded-full bg-gradient-to-b from-[#b6ffd8] to-[#22c97a] px-8 text-base font-bold text-ink transition active:scale-95 disabled:opacity-50 disabled:active:scale-100',
  secondary:
    'h-12 rounded-full bg-white/15 px-6 text-base font-semibold ring-1 ring-white/30 transition hover:bg-white/25 disabled:opacity-50',
  danger:
    'h-12 rounded-full bg-white/10 px-6 text-base font-semibold text-sun ring-1 ring-sun/50 transition hover:bg-sun/15 disabled:opacity-50',
  small:
    'h-9 rounded-full bg-white/15 px-4 text-sm font-semibold ring-1 ring-white/30 transition hover:bg-white/25 disabled:opacity-50',
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

/** 页面外壳:统一的标题和滚动区域(内容多时放进滚动区,不撑破窗口)。 */
export function Page(props: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col px-12 pb-8 pt-16">
      <h1 className="shrink-0 text-4xl font-semibold">{props.title}</h1>
      <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
        {props.children}
      </div>
    </div>
  );
}
