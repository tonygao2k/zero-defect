import { z } from 'zod';

/**
 * 练习题的配图。模型只给出图的参数,图由代码按固定模板画出来,
 * 所以图一定规整;参数不合法的题直接丢弃,不会出现画错的图。
 * 第一期有三种:正方体展开图、数轴、条形统计图。
 */
export type CubeNetFigure = {
  type: 'cube_net';
  /** 六个格子,row/col 从 0 开始,text 是格子里写的字。 */
  cells: { row: number; col: number; text: string }[];
};

export type NumberLineFigure = {
  type: 'number_line';
  min: number;
  max: number;
  /** 每一小格代表的数。 */
  step: number;
  /** 数轴上标出的点,label 一般是 A、B 这样的字母。 */
  marks: { value: number; label: string }[];
};

export type BarChartFigure = {
  type: 'bar_chart';
  unit: string;
  bars: { label: string; value: number }[];
};

/**
 * 小正方体搭成的立体图形。heights 是俯视的位置表:
 * 第一行是最后排,最后一行是最前排,每行从左到右;数字是这个位置叠了几个正方体。
 */
export type CubeStackFigure = {
  type: 'cube_stack';
  heights: number[][];
};

export type Figure =
  | CubeNetFigure
  | NumberLineFigure
  | BarChartFigure
  | CubeStackFigure;

export type FigureParse = { ok: true; figure: Figure | null } | { ok: false };

const text = (max: number) => z.coerce.string().trim().min(1).max(max);
const num = z.coerce.number().finite();

const CubeNetSchema = z.object({
  type: z.literal('cube_net'),
  cells: z
    .array(
      z.object({
        row: z.coerce.number().int().min(0).max(9),
        col: z.coerce.number().int().min(0).max(9),
        text: text(4),
      }),
    )
    .length(6),
});

const NumberLineSchema = z.object({
  type: z.literal('number_line'),
  min: num,
  max: num,
  step: num,
  marks: z
    .array(z.object({ value: num, label: text(4) }))
    .min(1)
    .max(6),
});

const BarChartSchema = z.object({
  type: z.literal('bar_chart'),
  unit: z.coerce.string().trim().max(6).default(''),
  bars: z
    .array(z.object({ label: text(6), value: num.min(0) }))
    .min(2)
    .max(8),
});

const CubeStackSchema = z.object({
  type: z.literal('cube_stack'),
  heights: z
    .array(z.array(z.coerce.number().int().min(0).max(4)).min(1).max(4))
    .min(1)
    .max(4),
});

/** 数轴最多画这么多小格,再多就挤在一起看不清。 */
export const MAX_NUMBER_LINE_TICKS = 20;

const key = (row: number, col: number) => `${row},${col}`;

/**
 * 按展开图把正方体“滚”一遍,算出每个格子对应立方体的哪个面。
 * 面的编号:0 下、1 上、2 北、3 南、4 东、5 西;编号相差 1 的一对(0-1、2-3、4-5)互为对面。
 * 返回每个格子的面编号;不是合法的展开图(不连通、有 2×2、折起来重叠)返回 null。
 */
export function foldCubeNet(cells: CubeNetFigure['cells']): number[] | null {
  if (cells.length !== 6) return null;
  const at = new Map(cells.map((c, i) => [key(c.row, c.col), i]));
  if (at.size !== 6) return null;
  // 展开图里不会有 2×2 的方块。
  for (const c of cells) {
    if (
      at.has(key(c.row + 1, c.col)) &&
      at.has(key(c.row, c.col + 1)) &&
      at.has(key(c.row + 1, c.col + 1))
    )
      return null;
  }
  // 方向 → 滚动后 [下, 上, 北, 南, 东, 西] 各取旧状态的哪一个。
  const roll: Record<string, [number, number, number, number, number, number]> =
    {
      east: [4, 5, 2, 3, 1, 0],
      west: [5, 4, 2, 3, 0, 1],
      south: [3, 2, 0, 1, 4, 5],
      north: [2, 3, 1, 0, 4, 5],
    };
  const steps: [string, number, number][] = [
    ['east', 0, 1],
    ['west', 0, -1],
    ['south', 1, 0],
    ['north', -1, 0],
  ];

  const face: (number | null)[] = Array(6).fill(null);
  const state: number[][] = Array(6).fill([]);
  face[0] = 0;
  state[0] = [0, 1, 2, 3, 4, 5];
  const queue = [0];
  while (queue.length > 0) {
    const i = queue.shift()!;
    for (const [dir, dr, dc] of steps) {
      const j = at.get(key(cells[i].row + dr, cells[i].col + dc));
      if (j === undefined || face[j] !== null) continue;
      const next = roll[dir].map((from) => state[i][from]);
      state[j] = next;
      face[j] = next[0];
      queue.push(j);
    }
  }
  if (face.some((f) => f === null)) return null;
  if (new Set(face).size !== 6) return null;
  return face as number[];
}

/** 展开图里与某个字相对的字;找不到或展开图不合法返回 null。 */
export function oppositeFace(
  figure: CubeNetFigure,
  label: string,
): string | null {
  const faces = foldCubeNet(figure.cells);
  if (!faces) return null;
  const i = figure.cells.findIndex((c) => c.text === label.trim());
  if (i < 0) return null;
  const j = faces.findIndex((f) => f === (faces[i] ^ 1));
  return figure.cells[j].text;
}

export const STACK_VIEWS = ['front', 'back', 'left', 'right', 'top'] as const;
export type StackView = (typeof STACK_VIEWS)[number];

/**
 * 从某个方向看立体图形,能看到几个小正方形:
 * 前、后看是每一列的最高层之和;左、右看是每一行的最高层之和;上面看是有方块的位置数。
 * view 不认识返回 null。
 */
export function stackViewCount(
  figure: CubeStackFigure,
  view: string,
): number | null {
  const rows = figure.heights;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  if (view === 'front' || view === 'back') {
    const cols = rows[0].length;
    return sum(
      Array.from({ length: cols }, (_, c) =>
        Math.max(...rows.map((r) => r[c])),
      ),
    );
  }
  if (view === 'left' || view === 'right') {
    return sum(rows.map((r) => Math.max(...r)));
  }
  if (view === 'top')
    return sum(rows.map((r) => r.filter((h) => h > 0).length));
  return null;
}

/** 非零的位置是否连成一片(上下左右相邻算相连)。 */
function stackConnected(heights: number[][]): boolean {
  const cells: [number, number][] = [];
  heights.forEach((r, i) => r.forEach((h, j) => h > 0 && cells.push([i, j])));
  if (cells.length === 0) return false;
  const seen = new Set<string>([cells[0].join(',')]);
  const todo = [cells[0]];
  while (todo.length > 0) {
    const [i, j] = todo.pop()!;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next: [number, number] = [i + di, j + dj];
      if ((heights[next[0]]?.[next[1]] ?? 0) > 0 && !seen.has(next.join(','))) {
        seen.add(next.join(','));
        todo.push(next);
      }
    }
  }
  return seen.size === cells.length;
}

/** 规整模型给出的配图。没有配图返回 ok+null;有但不合法返回 ok:false(这道题要丢弃)。 */
export function parseFigure(raw: unknown): FigureParse {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, figure: null };
  }
  const kind =
    typeof raw === 'object' ? (raw as { type?: unknown }).type : undefined;

  if (kind === 'cube_net') {
    const p = CubeNetSchema.safeParse(raw);
    if (!p.success) return { ok: false };
    const texts = new Set(p.data.cells.map((c) => c.text));
    if (texts.size !== 6) return { ok: false };
    if (!foldCubeNet(p.data.cells)) return { ok: false };
    return { ok: true, figure: p.data };
  }

  if (kind === 'number_line') {
    const p = NumberLineSchema.safeParse(raw);
    if (!p.success) return { ok: false };
    const { min, max, step, marks } = p.data;
    if (!(max > min) || !(step > 0)) return { ok: false };
    if ((max - min) / step > MAX_NUMBER_LINE_TICKS) return { ok: false };
    if (marks.some((m) => m.value < min || m.value > max)) return { ok: false };
    if (new Set(marks.map((m) => m.label)).size !== marks.length)
      return { ok: false };
    return { ok: true, figure: p.data };
  }

  if (kind === 'bar_chart') {
    const p = BarChartSchema.safeParse(raw);
    if (!p.success) return { ok: false };
    if (new Set(p.data.bars.map((b) => b.label)).size !== p.data.bars.length)
      return { ok: false };
    if (p.data.bars.every((b) => b.value === 0)) return { ok: false };
    return { ok: true, figure: p.data };
  }

  if (kind === 'cube_stack') {
    const p = CubeStackSchema.safeParse(raw);
    if (!p.success) return { ok: false };
    const { heights } = p.data;
    if (heights.some((r) => r.length !== heights[0].length))
      return { ok: false };
    const total = heights.flat().reduce((a, b) => a + b, 0);
    if (total < 2 || total > 12) return { ok: false };
    // 最外圈的行和列不能是空的,否则图会带多余的空白。
    const lastRow = heights[heights.length - 1];
    const firstCol = heights.map((r) => r[0]);
    const lastCol = heights.map((r) => r[r.length - 1]);
    if (
      ![heights[0], lastRow, firstCol, lastCol].every((l) =>
        l.some((h) => h > 0),
      )
    )
      return { ok: false };
    if (!stackConnected(heights)) return { ok: false };
    return { ok: true, figure: p.data };
  }

  return { ok: false };
}

/**
 * 把图翻译成文字,给独立求解用:求解的模型看不到图,所以要写出做题需要的全部信息。
 * 数轴和条形图直接给出读数(读图本身就是题目);展开图只给格子的位置,
 * 哪两个面相对要求解的模型自己想,这里不透露。
 */
export function describeFigure(figure: Figure): string {
  if (figure.type === 'cube_net') {
    const rows = Math.max(...figure.cells.map((c) => c.row));
    const cols = Math.max(...figure.cells.map((c) => c.col));
    const lines: string[] = [];
    for (let r = 0; r <= rows; r++) {
      const cells: string[] = [];
      for (let c = 0; c <= cols; c++) {
        const cell = figure.cells.find((x) => x.row === r && x.col === c);
        cells.push(cell ? `[${cell.text}]` : '[ ]');
      }
      lines.push(cells.join(''));
    }
    return `【配图:正方体展开图,[ ] 表示没有格子,折成正方体时各字都在外表面】\n${lines.join('\n')}`;
  }
  if (figure.type === 'number_line') {
    const marks = figure.marks
      .map((m) => `点 ${m.label} 在 ${m.value}`)
      .join(';');
    return `【配图:数轴,从 ${figure.min} 到 ${figure.max},每小格 ${figure.step};${marks}】`;
  }
  if (figure.type === 'cube_stack') {
    const lines = figure.heights
      .map((r) => r.map((h) => (h > 0 ? `[${h}]` : '[ ]')).join(''))
      .join('\n');
    return `【配图:小正方体搭成的立体图形的位置表,每格的数字是这个位置叠放的小正方体个数,[ ] 表示没有;第一行是最后排,最后一行是最前排,每行从左到右】\n${lines}`;
  }
  const bars = figure.bars.map((b) => `${b.label}:${b.value}`).join(',');
  return `【配图:条形统计图${figure.unit ? `,单位 ${figure.unit}` : ''};${bars}】`;
}
