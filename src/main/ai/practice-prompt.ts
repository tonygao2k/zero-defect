import { describeFigure, type Figure } from '../../shared/figure';
import type { ChatMessage } from './llm-client';

const GRADE_NAMES = ['', '一', '二', '三', '四', '五', '六'];

export type GenerateInput = {
  grade: number;
  knowledgePoint: string;
  rootCause: { label: string; description: string };
  /** 孩子真实做错的题(最多两道),让新题贴近他犯错的方式。 */
  examples: {
    question: string;
    studentAnswer: string;
    /** 原题配图的类别和特点,没有图为空。 */
    figureKind?: string;
    figureNote?: string;
  }[];
  /** 之前已经出过的题,新题不要重复。 */
  avoid: string[];
  count: number;
};

const FIGURE_LABELS: Record<string, string> = {
  cube_net: '正方体展开图',
  number_line: '数轴',
  bar_chart: '条形统计图',
  cube_stack: '小正方体搭的立体图形',
};

/** 原题带图时的提示:能画的类别要求变式题也配同类的图,画不了的提醒用文字讲清楚。 */
function figureHint(e: { figureKind?: string; figureNote?: string }): string {
  if (!e.figureKind || e.figureKind === 'none') return '';
  const note = e.figureNote ? `,图的特点:${e.figureNote}` : '';
  const label = FIGURE_LABELS[e.figureKind];
  return label
    ? `【原题配有${label}${note};新题也要配同类的图】`
    : `【原题配有一幅图${note};这种图画不了,新题改成不依赖图、已知条件全写在文字里的同类题】`;
}

/** 出变式题:同一个知识点和错误原因,换数值或情境。 */
export function buildGenerateMessages(input: GenerateInput): ChatMessage[] {
  const examples = input.examples
    .map(
      (e, i) =>
        `例${i + 1}:${e.question}(孩子的错误答案:${e.studentAnswer || '未作答'})${figureHint(e)}`,
    )
    .join('\n');
  const system = `你是一位经验丰富的小学数学老师,要为${GRADE_NAMES[input.grade] ?? input.grade}年级的孩子出练习题。

只返回一个 JSON 对象,不要输出其他文字。结构如下:
{
  "questions": [
    {
      "question_markdown": "题目。数学公式用 LaTeX,行内公式写成 $...$",
      "answer_type": "choice 或 number",
      "options": ["选项A的内容", "选项B的内容", "选项C的内容", "选项D的内容"],
      "correct_answer": "choice 填选项字母 A/B/C/D;number 填最终结果",
      "unit": "number 题的单位,没有就填空字符串",
      "solution_markdown": "简短的解题思路",
      "figure": null,
      "opposite_of": null,
      "view_of": null
    }
  ]
}

要求:
1. 出 ${input.count} 道题,考查同一个知识点,针对同一种错误原因,但数值和情境要和例题不同,题与题之间也不要重复。
2. 题型只能是两种:choice(选择题,必须给 4 个选项,干扰项要对应孩子可能的典型错误)和 number(计算题或应用题,孩子只输入最终结果,不写过程)。两种题型都要有。不要出判断对错题,也不要出其他题型;题目里不要要求“列出算式”“写出过程”,只问最终结果。
3. number 题的答案必须是唯一确定的数:整数、小数、最简分数(写成 a/b),或带余数的除法(写成 商...余数)。不要出答案不唯一的题,也不要要求写过程。
4. 难度和孩子的年级相当,不要超纲。题目表述要清楚完整,已知条件都要写在题目里。题目里的 □ 只能出现在选项或孩子要填的结果处,不要用 □ 表示已知条件里缺少的数。
5. 大多数题不需要配图,figure 填 null。但“展开图中哪两个面相对”和“从某个方向看立体图形”这两类题必须带对应的 figure,不能只用文字描述。其他题只有离不开图时才配图,而且只能用下面四种,图由程序按你给的参数画出来:
   - 正方体展开图(考查“哪两个面相对”):{"type":"cube_net","cells":[{"row":0,"col":1,"text":"春"}, ...]}。必须正好 6 个格子,row 和 col 从 0 开始,格子之间上下左右相连,不能有 2×2 的方块,必须能折成正方体(例如中间一排四个、上下各一个);每格只写 1 个字或 1 个字母,互不相同。展开图题必须是选择题,并在 opposite_of 里写被问的那个字,正确选项必须是折成正方体后与它相对的字。题目文字里不要再说明哪两个面相对,答案要靠看图得出。
   - 数轴:{"type":"number_line","min":0,"max":10,"step":1,"marks":[{"value":3.5,"label":"A"}]}。小格不超过 20 个,点要落在范围内,题目问点表示的数或两点的关系。
   - 条形统计图:{"type":"bar_chart","unit":"人","bars":[{"label":"一班","value":30}]}。2 到 8 根,数值不为负,题目问读数、比较或求和差。
   - 立体图形(小正方体搭成,考查从某个方向看能看到几个小正方形):{"type":"cube_stack","heights":[[1,0],[2,1]]}。heights 是俯视的位置表,第一行是最后排,最后一行是最前排,每行从左到右,数字是这个位置叠了几个小正方体(0 到 4);最多 4 行 4 列,小正方体总数 2 到 12 个,有方块的位置要上下左右连成一片,最外圈的行和列不能全是 0。同时在 view_of 里写看的方向:front(从前面看)、back、left(从左面看)、right、top(从上面看)。正确答案必须是从该方向看到的小正方形个数:前、后看是每一列最高层数之和,左、右看是每一行最高层数之和,上面看是有方块的位置数。题目文字里不要再描述每个位置叠几个,让孩子看图。
   有配图时,题目文字里不要把图里能读出的数据再写一遍。题目说“下图”“右图”“展开图”时必须带 figure;不能带 figure 的题,题目里就不要提图。绝不要用文字、表格或 LaTeX 的 array 去画图。没有展开图时 opposite_of 填 null,没有立体图形时 view_of 填 null。
6. correct_answer 必须是你仔细算出的正确结果。`;

  const avoid = input.avoid.map((q) => `- ${q}`).join('\n');
  const user = `知识点:${input.knowledgePoint}
错误原因:${input.rootCause.label}。${input.rootCause.description}
${examples ? `孩子做错的题:\n${examples}` : ''}
${avoid ? `以下题目之前已经出过,不要重复:\n${avoid}` : ''}

请出 ${input.count} 道新题。`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * 独立求解:只给题目(选择题连同选项),不给原来的答案,让模型自己做一遍。
 * 两次结果不一致的题直接丢弃(设计文档 2.3)。
 */
export function buildSolveMessages(question: {
  questionMarkdown: string;
  answerType: 'choice' | 'number';
  options: string[];
  figure?: Figure | null;
}): ChatMessage[] {
  const options =
    question.answerType === 'choice'
      ? '\n' + question.options.map((o, i) => `${'ABCD'[i]}. ${o}`).join('\n')
      : '';
  const how =
    question.answerType === 'choice'
      ? '这是选择题,answer 填你认为正确的选项字母。'
      : '这是计算或应用题,answer 填最终结果:整数、小数、最简分数(a/b)或带余数的除法(商...余数),不带单位。';
  return [
    {
      role: 'system',
      content: `你是一位严谨的小学数学老师。请独立解答下面的题目,仔细检查后再作答。推理请简短,最后单独一行给出 JSON 对象:{"answer": "..."}。${how}`,
    },
    {
      role: 'user',
      content: `${question.questionMarkdown}${question.figure ? `\n${describeFigure(question.figure)}` : ''}${options}`,
    },
  ];
}
