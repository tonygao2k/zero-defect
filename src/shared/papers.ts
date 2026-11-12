/** 一份试卷最多几页。超出时提示家长分次提交(设计文档 2.1)。 */
export const MAX_PAGES_PER_PAPER = 6;

/** 试卷名称标签的最大长度。 */
export const PAPER_TITLE_MAX_LENGTH = 50;

export type PaperStatus = 'processing' | 'done' | 'failed';

/** 默认的试卷名称:精确到小时,如“2026年11月12日 15时”。 */
export function defaultPaperTitle(date: Date = new Date()): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours()}时`;
}

/** 空白名称回退到默认值;过长则截断。 */
export function normalizePaperTitle(raw: string, now?: Date): string {
  const trimmed = raw.trim().slice(0, PAPER_TITLE_MAX_LENGTH);
  return trimmed || defaultPaperTitle(now);
}

export type PaperSummary = {
  id: string;
  title: string;
  status: PaperStatus;
  errorMessage: string | null;
  createdAt: string;
  /** 待确认的错题数,标签旁据此显示标注。 */
  pendingCount: number;
  totalCount: number;
};
