import { describe, expect, it } from 'vitest';
import { niceAxis } from './FigureView';

describe('niceAxis', () => {
  it('uses whole-number ticks', () => {
    expect(niceAxis(42)).toEqual({ niceMax: 50, tick: 10 });
    expect(niceAxis(30)).toEqual({ niceMax: 30, tick: 5 });
    expect(niceAxis(7)).toEqual({ niceMax: 8, tick: 2 });
    expect(niceAxis(120)).toEqual({ niceMax: 120, tick: 20 });
    expect(niceAxis(1)).toEqual({ niceMax: 1, tick: 0.2 });
  });

  it('never needs more than 6 segments', () => {
    for (const v of [3, 9, 13, 28, 55, 99, 101, 350, 999]) {
      const { niceMax, tick } = niceAxis(v);
      expect(niceMax).toBeGreaterThanOrEqual(v);
      expect(niceMax / tick).toBeLessThanOrEqual(6);
    }
  });
});
