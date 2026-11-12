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

const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;

/** 去掉孩子可能顺手写上的单位(如“12 个”“36cm”),只留结果本身。 */
function stripUnit(text: string, unit: string): string {
  const t = normalizeAnswer(text);
  const u = normalizeAnswer(unit);
  return u && t.endsWith(u) ? t.slice(0, -u.length) : t;
}

/**
 * 练习题判分。选择题比选项字母;计算题和应用题比结果:
 * 先比规整后的文字(分数、带余数的除法按写法比较),
 * 两边都是普通数字时再按数值比较,所以 0.50 和 0.5 算相同。
 * 不跨形式比较(0.5 和 1/2),因为小学常要求写成最简分数。
 */
export function checkPracticeAnswer(
  answerType: 'choice' | 'number',
  submitted: string,
  correct: string,
  unit = '',
): boolean {
  if (answerType === 'choice') {
    return (
      normalizeAnswer(submitted).slice(0, 1) !== '' &&
      normalizeAnswer(submitted).slice(0, 1) ===
        normalizeAnswer(correct).slice(0, 1)
    );
  }
  const s = stripUnit(submitted, unit);
  const c = stripUnit(correct, unit);
  if (s === '' || c === '') return false;
  if (s === c) return true;
  return (
    PLAIN_NUMBER.test(s) && PLAIN_NUMBER.test(c) && Number(s) === Number(c)
  );
}
