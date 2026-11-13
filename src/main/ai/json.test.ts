import { describe, expect, it } from 'vitest';
import { extractJson } from './json';

describe('extractJson', () => {
  it('parses plain and fenced JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('说明\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('returns null when there is no object', () => {
    expect(extractJson('没有 JSON')).toBeNull();
    expect(extractJson('{坏的')).toBeNull();
  });

  it('finds the final JSON after reasoning that contains LaTeX braces', () => {
    const text =
      '我们来分析:\n$$\n\\begin{array}{c} 1 \\\\ 2 \\end{array}\n$$\n所以答案是:\n{"answer": "B"}';
    expect(extractJson(text)).toEqual({ answer: 'B' });
  });

  it('ignores braces inside JSON strings', () => {
    const text = '推理 \\frac{1}{2} 之后:{"answer": "a}b"}';
    expect(extractJson(text)).toEqual({ answer: 'a}b' });
  });

  it('keeps the whole outer object when it parses', () => {
    const text = '{"questions":[{"q":"x"}]}';
    expect(extractJson(text)).toEqual({ questions: [{ q: 'x' }] });
  });
});
