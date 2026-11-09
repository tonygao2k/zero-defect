/**
 * 把答案规整成可比较的形式:全角转半角,去掉空白和 $,统一各种“……”“余”写法。
 * 例如 "4\cdots\cdots1"、"4...1"、"4……1"、"4余1" 规整后相同。
 */
export function normalizeAnswer(input: string | null | undefined): string {
  return (input ?? '')
    .normalize('NFKC')
    .replace(/\$/g, '')
    .replace(/\\(?:cdots|ldots|dots)|\.{2,}|⋯|余/g, '…')
    .replace(/…+/g, '…')
    .replace(/(?<=\d),(?=\d{3}(?!\d))/g, '')
    .replace(/\s+/g, '')
    .replace(/[。.]+$/, '')
    .toLowerCase();
}

/**
 * 孩子的答案和模型自己算出的正确答案一致,说明这道题没做错。
 * 任何一边为空都不算“答对”(可能是没写答案),保留给家长判断。
 */
export function isAnsweredCorrectly(
  student: string | null | undefined,
  correct: string | null | undefined,
): boolean {
  const s = normalizeAnswer(student);
  const c = normalizeAnswer(correct);
  return s !== '' && c !== '' && s === c;
}
