import { describe, expect, it } from 'vitest';
import { normalizeSquares } from './MarkdownView';

describe('normalizeSquares', () => {
  it('leaves text without boxes alone', () => {
    expect(normalizeSquares('$1+2$ 等于几')).toBe('$1+2$ 等于几');
  });

  it('turns a box outside formulas into an inline formula', () => {
    expect(normalizeSquares('5 + □ = 9')).toBe('5 + $\\square$ = 9');
  });

  it('turns a box inside a formula into \\square without nesting dollars', () => {
    expect(normalizeSquares('$5 + □ = 9$,□ 是几')).toBe(
      '$5 + \\square  = 9$,$\\square$ 是几',
    );
  });
});
