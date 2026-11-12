import { describe, expect, it } from 'vitest';
import {
  checkPracticeAnswer,
  isAnsweredCorrectly,
  normalizeAnswer,
} from './answers';

describe('normalizeAnswer / isAnsweredCorrectly', () => {
  it('treats every remainder notation as the same answer', () => {
    const forms = [
      '4\\cdots\\cdots1',
      '4...1',
      '4……1',
      '4…1',
      '4余1',
      ' 4 ... 1 ',
      '$4\\cdots1$',
    ];
    const set = new Set(forms.map(normalizeAnswer));
    expect(set.size).toBe(1);
  });

  it('handles full-width characters, spaces, dollar signs and thousands separators', () => {
    expect(normalizeAnswer(' ５６ ')).toBe('56');
    expect(normalizeAnswer('$56$')).toBe('56');
    expect(normalizeAnswer('1,000')).toBe('1000');
    expect(normalizeAnswer(null)).toBe('');
  });

  it('does not merge different numbers', () => {
    expect(isAnsweredCorrectly('7', '9')).toBe(false);
    expect(isAnsweredCorrectly('8...5', '9...1')).toBe(false);
    expect(isAnsweredCorrectly('854', '754')).toBe(false);
  });

  it('is true only when both sides are present and equal', () => {
    expect(isAnsweredCorrectly('56', '56')).toBe(true);
    expect(isAnsweredCorrectly('', '56')).toBe(false);
    expect(isAnsweredCorrectly('56', '')).toBe(false);
    expect(isAnsweredCorrectly(null, null)).toBe(false);
  });
});

describe('checkPracticeAnswer', () => {
  it('compares choice answers by letter, ignoring case and extra text', () => {
    expect(checkPracticeAnswer('choice', 'b', 'B')).toBe(true);
    expect(checkPracticeAnswer('choice', 'B.', 'B')).toBe(true);
    expect(checkPracticeAnswer('choice', 'C', 'B')).toBe(false);
    expect(checkPracticeAnswer('choice', '', 'B')).toBe(false);
  });

  it('compares plain numbers by value', () => {
    expect(checkPracticeAnswer('number', '0.50', '0.5')).toBe(true);
    expect(checkPracticeAnswer('number', ' 12 ', '12')).toBe(true);
    expect(checkPracticeAnswer('number', '12', '13')).toBe(false);
  });

  it('ignores a unit the child typed, but not a different number', () => {
    expect(checkPracticeAnswer('number', '36cm', '36', 'cm')).toBe(true);
    expect(checkPracticeAnswer('number', '36 个', '36', '个')).toBe(true);
    expect(checkPracticeAnswer('number', '35个', '36', '个')).toBe(false);
  });

  it('accepts every way of writing a remainder', () => {
    expect(checkPracticeAnswer('number', '4余1', '4...1')).toBe(true);
    expect(checkPracticeAnswer('number', '4…1', '4……1')).toBe(true);
    expect(checkPracticeAnswer('number', '5...1', '4...1')).toBe(false);
  });

  it('does not treat a fraction and a decimal as the same answer', () => {
    expect(checkPracticeAnswer('number', '1/2', '1/2')).toBe(true);
    expect(checkPracticeAnswer('number', '0.5', '1/2')).toBe(false);
    expect(checkPracticeAnswer('number', '2/4', '1/2')).toBe(false);
  });

  it('never accepts an empty answer', () => {
    expect(checkPracticeAnswer('number', '', '0')).toBe(false);
    expect(checkPracticeAnswer('number', '   ', '5')).toBe(false);
  });
});
