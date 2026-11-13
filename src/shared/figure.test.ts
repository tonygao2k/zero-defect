import { describe, expect, it } from 'vitest';
import {
  stackViewCount,
  describeFigure,
  foldCubeNet,
  oppositeFace,
  parseFigure,
  type CubeNetFigure,
} from './figure';

const net = (cells: [number, number, string][]): CubeNetFigure => ({
  type: 'cube_net',
  cells: cells.map(([row, col, text]) => ({ row, col, text })),
});

// 1-4-1:中间一排四个,上下各一个。同一排的 1、3 相对,2、4 相对,上下两个相对。
const cross = net([
  [0, 1, '上'],
  [1, 0, '左'],
  [1, 1, '前'],
  [1, 2, '右'],
  [1, 3, '后'],
  [2, 1, '下'],
]);

describe('cube net folding', () => {
  it('finds opposite faces of a 1-4-1 net', () => {
    expect(oppositeFace(cross, '左')).toBe('右');
    expect(oppositeFace(cross, '右')).toBe('左');
    expect(oppositeFace(cross, '前')).toBe('后');
    expect(oppositeFace(cross, '上')).toBe('下');
  });

  it('finds opposite faces of a 2-3-1 net', () => {
    // 行0:A B   行1:  C D E   行2:    F  (阶梯形)
    const stairs = net([
      [0, 0, 'A'],
      [0, 1, 'B'],
      [1, 1, 'C'],
      [1, 2, 'D'],
      [1, 3, 'E'],
      [2, 1, 'F'],
    ]);
    // 中间一排 C D E:C 和 E 相对;B 在 C 上方、F 在 C 下方,所以 B 和 F 相对;剩下 A 与 D 相对。
    expect(oppositeFace(stairs, 'C')).toBe('E');
    expect(oppositeFace(stairs, 'B')).toBe('F');
    expect(oppositeFace(stairs, 'A')).toBe('D');
  });

  it('gives each face a different position and opposite pairs add up', () => {
    const faces = foldCubeNet(cross.cells)!;
    expect(new Set(faces).size).toBe(6);
    for (let i = 0; i < 6; i++) {
      const j = faces.indexOf(faces[i] ^ 1);
      expect(faces[j] ^ 1).toBe(faces[i]);
    }
  });

  it('rejects shapes that cannot fold into a cube', () => {
    // 一排六个:卷起来会重叠。
    const line = net([0, 1, 2, 3, 4, 5].map((c) => [0, c, `${c}`]));
    expect(foldCubeNet(line.cells)).toBeNull();
    // 含 2×2 方块。
    const block = net([
      [0, 0, 'a'],
      [0, 1, 'b'],
      [1, 0, 'c'],
      [1, 1, 'd'],
      [2, 0, 'e'],
      [3, 0, 'f'],
    ]);
    expect(foldCubeNet(block.cells)).toBeNull();
    // 不连通。
    const apart = net([
      [0, 0, 'a'],
      [0, 1, 'b'],
      [0, 2, 'c'],
      [3, 0, 'd'],
      [3, 1, 'e'],
      [3, 2, 'f'],
    ]);
    expect(foldCubeNet(apart.cells)).toBeNull();
  });

  it('returns null for an unknown label', () => {
    expect(oppositeFace(cross, '中')).toBeNull();
  });
});

describe('parseFigure', () => {
  it('treats a missing figure as none', () => {
    expect(parseFigure(undefined)).toEqual({ ok: true, figure: null });
    expect(parseFigure(null)).toEqual({ ok: true, figure: null });
  });

  it('accepts a valid cube net, and rejects duplicate or long labels', () => {
    expect(parseFigure(cross).ok).toBe(true);
    const dup = net(cross.cells.map((c) => [c.row, c.col, '同']));
    expect(parseFigure(dup).ok).toBe(false);
    const long = net(
      cross.cells.map((c) => [
        c.row,
        c.col,
        `${c.text}${c.text}${c.text}${c.text}${c.text}`,
      ]),
    );
    expect(parseFigure(long).ok).toBe(false);
  });

  it('accepts a number line and rejects out-of-range marks or too many ticks', () => {
    const ok = {
      type: 'number_line',
      min: 0,
      max: 10,
      step: 1,
      marks: [{ value: 3.5, label: 'A' }],
    };
    expect(parseFigure(ok).ok).toBe(true);
    expect(parseFigure({ ...ok, marks: [{ value: 11, label: 'A' }] }).ok).toBe(
      false,
    );
    expect(parseFigure({ ...ok, max: 1000 }).ok).toBe(false);
    expect(parseFigure({ ...ok, step: 0 }).ok).toBe(false);
    expect(parseFigure({ ...ok, max: -1 }).ok).toBe(false);
  });

  it('accepts a bar chart and rejects negative, all-zero or repeated bars', () => {
    const ok = {
      type: 'bar_chart',
      unit: '人',
      bars: [
        { label: '一班', value: 30 },
        { label: '二班', value: 25 },
      ],
    };
    expect(parseFigure(ok).ok).toBe(true);
    expect(
      parseFigure({ ...ok, bars: [{ label: 'a', value: -1 }, ok.bars[0]] }).ok,
    ).toBe(false);
    expect(
      parseFigure({
        ...ok,
        bars: [
          { label: 'a', value: 0 },
          { label: 'b', value: 0 },
        ],
      }).ok,
    ).toBe(false);
    expect(parseFigure({ ...ok, bars: [ok.bars[0], ok.bars[0]] }).ok).toBe(
      false,
    );
  });

  it('rejects an unknown figure type', () => {
    expect(parseFigure({ type: 'pie' }).ok).toBe(false);
  });
});

describe('describeFigure', () => {
  it('lays a cube net out on a grid without revealing opposite faces', () => {
    const text = describeFigure(cross);
    expect(text).toContain('[上]');
    expect(text.split('\n')).toHaveLength(4); // 一行说明 + 三行格子
    expect(text).not.toContain('相对');
  });

  it('states number line and bar chart readings', () => {
    expect(
      describeFigure({
        type: 'number_line',
        min: 0,
        max: 2,
        step: 0.5,
        marks: [{ value: 1.5, label: 'A' }],
      }),
    ).toContain('点 A 在 1.5');
    expect(
      describeFigure({
        type: 'bar_chart',
        unit: '人',
        bars: [
          { label: '一班', value: 30 },
          { label: '二班', value: 25 },
        ],
      }),
    ).toContain('一班:30');
  });
});

describe('cube stack', () => {
  // 后排 1 1 1,前排 3 0 0:从前面看每列取最高 3+1+1=5,从左面看每行取最高 1+3=4。
  const stack = {
    type: 'cube_stack',
    heights: [
      [1, 1, 1],
      [3, 0, 0],
    ],
  } as const;

  it('counts the squares seen from each direction', () => {
    const fig = parseFigure(stack);
    expect(fig.ok).toBe(true);
    const f = stack as unknown as Parameters<typeof stackViewCount>[0];
    expect(stackViewCount(f, 'front')).toBe(5);
    expect(stackViewCount(f, 'back')).toBe(5);
    expect(stackViewCount(f, 'left')).toBe(4);
    expect(stackViewCount(f, 'right')).toBe(4);
    expect(stackViewCount(f, 'top')).toBe(4);
    expect(stackViewCount(f, 'sideways')).toBeNull();
  });

  it('rejects shapes that are disconnected, empty at the edge, or the wrong size', () => {
    const bad = (heights: number[][]) =>
      parseFigure({ type: 'cube_stack', heights }).ok;
    expect(bad([[1, 0, 1]])).toBe(false); // 不相连
    expect(
      bad([
        [0, 1, 1],
        [0, 1, 1],
      ]),
    ).toBe(false); // 最左一列全是 0
    expect(bad([[1]])).toBe(false); // 只有 1 块
    expect(
      bad([
        [4, 4, 4, 4],
        [4, 0, 0, 0],
      ]),
    ).toBe(false); // 超过 12 块
    expect(bad([[1, 1], [1]])).toBe(false); // 每行长度不一
    expect(bad([[1, 5]])).toBe(false); // 一摞超过 4 层
    expect(
      bad([
        [1, 1],
        [1, 0],
      ]),
    ).toBe(true);
  });

  it('describes the grid without the answer', () => {
    const text = describeFigure(stack as never);
    expect(text).toContain('[1][1][1]');
    expect(text).toContain('[3][ ][ ]');
    expect(text).not.toMatch(/看到/);
  });
});

describe('inferFigureKind (old mistakes without a recorded kind)', async () => {
  const { inferFigureKind } = await import('./analysis');
  it('guesses from the question text', () => {
    expect(
      inferFigureKind('右面是一个正方体盒子的展开图,与“聚”相对的字是'),
    ).toBe('cube_net');
    expect(
      inferFigureKind('从前面、上面、侧面三个方向看下面的立体图形,连一连'),
    ).toBe('cube_stack');
    expect(inferFigureKind('根据下图,京京列出算式')).toBe('other');
    expect(inferFigureKind('看图列式计算')).toBe('other');
    expect(inferFigureKind('把 $12+8=20$ 改写成综合算式')).toBe('none');
  });
});
