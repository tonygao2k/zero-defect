import type {
  BarChartFigure,
  CubeNetFigure,
  CubeStackFigure,
  Figure,
  NumberLineFigure,
} from '../shared/figure';

/** 题目配图。图由参数按固定模板画出来,颜色固定为深色字,放在白色题卡里。 */
export function FigureView({ figure }: { figure: Figure }) {
  return (
    <div className="my-5 flex justify-center">
      {figure.type === 'cube_net' ? (
        <CubeNet figure={figure} />
      ) : figure.type === 'number_line' ? (
        <NumberLine figure={figure} />
      ) : figure.type === 'cube_stack' ? (
        <CubeStack figure={figure} />
      ) : (
        <BarChart figure={figure} />
      )}
    </div>
  );
}

const INK = '#052e22';
const LINE = '#0f6b46';
const FILL = '#e8fbf1';

function CubeNet({ figure }: { figure: CubeNetFigure }) {
  const size = 56;
  const rows = Math.max(...figure.cells.map((c) => c.row)) + 1;
  const cols = Math.max(...figure.cells.map((c) => c.col)) + 1;
  const pad = 4;
  return (
    <svg
      role="img"
      aria-label="正方体展开图"
      width={cols * size + pad * 2}
      height={rows * size + pad * 2}
      viewBox={`0 0 ${cols * size + pad * 2} ${rows * size + pad * 2}`}
    >
      {figure.cells.map((c) => (
        <g key={`${c.row},${c.col}`}>
          <rect
            x={pad + c.col * size}
            y={pad + c.row * size}
            width={size}
            height={size}
            fill={FILL}
            stroke={LINE}
            strokeWidth={2}
          />
          <text
            x={pad + c.col * size + size / 2}
            y={pad + c.row * size + size / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={c.text.length > 2 ? 16 : 24}
            fontWeight={600}
            fill={INK}
          >
            {c.text}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** 数字去掉浮点误差后再显示,如 0.30000000000000004 → 0.3。 */
const fmt = (n: number) => String(Number(n.toFixed(6)));

function NumberLine({ figure }: { figure: NumberLineFigure }) {
  const { min, max, step, marks } = figure;
  const width = 560;
  const left = 30;
  const right = width - 30;
  const y = 56;
  const span = right - left;
  const x = (v: number) => left + ((v - min) / (max - min)) * span;
  const count = Math.round((max - min) / step);
  const ticks = Array.from({ length: count + 1 }, (_, i) => min + i * step);
  // 刻度太密时只给部分刻度标数字,避免挤在一起。
  const every = count > 10 ? Math.ceil(count / 10) : 1;
  return (
    <svg
      role="img"
      aria-label="数轴"
      viewBox={`0 0 ${width} 100`}
      className="w-full max-w-xl"
    >
      <line
        x1={left - 12}
        y1={y}
        x2={right + 12}
        y2={y}
        stroke={INK}
        strokeWidth={2}
      />
      <path d={`M${right + 12} ${y} l-8 -5 v10 z`} fill={INK} />
      {ticks.map((v, i) => (
        <g key={i}>
          <line
            x1={x(v)}
            y1={y - 6}
            x2={x(v)}
            y2={y + 6}
            stroke={INK}
            strokeWidth={2}
          />
          {i % every === 0 && (
            <text
              x={x(v)}
              y={y + 24}
              textAnchor="middle"
              fontSize={14}
              fill={INK}
            >
              {fmt(v)}
            </text>
          )}
        </g>
      ))}
      {marks.map((m) => (
        <g key={m.label}>
          <circle cx={x(m.value)} cy={y} r={5} fill="#d9480f" />
          <text
            x={x(m.value)}
            y={y - 16}
            textAnchor="middle"
            fontSize={16}
            fontWeight={700}
            fill="#d9480f"
          >
            {m.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** 纵轴的刻度步长取 1、2、5 的倍数中最小的、且不超过 6 段的那个,上限是步长的整数倍。 */
export function niceAxis(maxValue: number): { niceMax: number; tick: number } {
  const magnitude = Math.floor(Math.log10(maxValue));
  for (let e = magnitude - 1; e <= magnitude + 1; e++) {
    for (const m of [1, 2, 5]) {
      const tick = m * 10 ** e;
      const segments = Math.ceil(maxValue / tick - 1e-9);
      if (segments <= 6) return { niceMax: segments * tick, tick };
    }
  }
  return { niceMax: maxValue, tick: maxValue };
}

/**
 * 立体图形:从前右上方看的等轴测图。位置表第一行是最后排,所以先画后排再画前排,
 * 同一排里先画左边再画右边,后画的盖住先画的,每个小正方体画顶面、左前面、右面三个面。
 */
function CubeStack({ figure }: { figure: CubeStackFigure }) {
  const rows = figure.heights.length;
  const cols = figure.heights[0].length;
  const u = 34;
  const cos = Math.cos(Math.PI / 6);
  const sin = 0.5;
  // 位置 (列 x 向右, 排 y 向前, 高 z 向上) → 屏幕坐标。
  const px = (x: number, y: number) => (x - y) * cos * u;
  const py = (x: number, y: number, z: number) => (x + y) * sin * u - z * u;
  const maxH = Math.max(...figure.heights.flat());
  const left = -rows * cos * u;
  const right = cols * cos * u;
  const top = -maxH * u;
  const bottom = (rows + cols) * sin * u;
  const pad = 10;
  const pt = (x: number, y: number, z: number) =>
    `${(px(x, y) - left + pad).toFixed(1)},${(py(x, y, z) - top + pad).toFixed(1)}`;
  const polygon = (pts: [number, number, number][]) =>
    pts.map(([x, y, z]) => pt(x, y, z)).join(' ');
  const cubes: { x: number; y: number; z: number }[] = [];
  figure.heights.forEach((row, y) =>
    row.forEach((h, x) => {
      for (let z = 0; z < h; z++) cubes.push({ x, y, z });
    }),
  );
  // 后排、左边、低处先画。
  cubes.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
  const width = right - left + pad * 2;
  const height = bottom - top + pad * 2;
  return (
    <svg
      role="img"
      aria-label="小正方体搭成的立体图形"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {cubes.map(({ x, y, z }) => (
        <g
          key={`${x},${y},${z}`}
          stroke={LINE}
          strokeWidth={1.5}
          strokeLinejoin="round"
        >
          <polygon
            fill="#f4fff9"
            points={polygon([
              [x, y, z + 1],
              [x + 1, y, z + 1],
              [x + 1, y + 1, z + 1],
              [x, y + 1, z + 1],
            ])}
          />
          <polygon
            fill="#a8e6c6"
            points={polygon([
              [x, y + 1, z + 1],
              [x + 1, y + 1, z + 1],
              [x + 1, y + 1, z],
              [x, y + 1, z],
            ])}
          />
          <polygon
            fill="#5fcf9b"
            points={polygon([
              [x + 1, y, z + 1],
              [x + 1, y + 1, z + 1],
              [x + 1, y + 1, z],
              [x + 1, y, z],
            ])}
          />
        </g>
      ))}
    </svg>
  );
}

function BarChart({ figure }: { figure: BarChartFigure }) {
  const { bars, unit } = figure;
  const width = 560;
  const height = 240;
  const left = 44;
  const bottom = 40;
  const top = 28;
  const maxValue = Math.max(...bars.map((b) => b.value));
  const { niceMax, tick } = niceAxis(maxValue);
  const plotH = height - top - bottom;
  const slot = (width - left - 16) / bars.length;
  const y = (v: number) => top + plotH - (v / niceMax) * plotH;
  const gridlines = Array.from(
    { length: Math.round(niceMax / tick) + 1 },
    (_, i) => i * tick,
  );
  return (
    <svg
      role="img"
      aria-label="条形统计图"
      viewBox={`0 0 ${width} ${height}`}
      className="w-full max-w-xl"
    >
      {unit && (
        <text x={4} y={14} fontSize={13} fill={INK}>
          单位:{unit}
        </text>
      )}
      {gridlines.map((v) => (
        <g key={v}>
          <line
            x1={left}
            y1={y(v)}
            x2={width - 8}
            y2={y(v)}
            stroke="#c9d8d1"
            strokeWidth={1}
          />
          <text
            x={left - 6}
            y={y(v)}
            textAnchor="end"
            dominantBaseline="central"
            fontSize={12}
            fill={INK}
          >
            {fmt(v)}
          </text>
        </g>
      ))}
      {bars.map((b, i) => {
        const bw = Math.min(48, slot * 0.6);
        const cx = left + slot * i + slot / 2;
        return (
          <g key={b.label}>
            <rect
              x={cx - bw / 2}
              y={y(b.value)}
              width={bw}
              height={top + plotH - y(b.value)}
              fill="#22c97a"
              stroke={LINE}
              strokeWidth={1.5}
            />
            <text
              x={cx}
              y={y(b.value) - 6}
              textAnchor="middle"
              fontSize={13}
              fontWeight={600}
              fill={INK}
            >
              {fmt(b.value)}
            </text>
            <text
              x={cx}
              y={height - bottom + 20}
              textAnchor="middle"
              fontSize={14}
              fill={INK}
            >
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
