import type { ChatMessage } from './llm-client';

const GRADE_NAMES = ['', '一', '二', '三', '四', '五', '六'];

export type GenerateInput = {
  grade: number;
  knowledgePoint: string;
  rootCause: { label: string; description: string };
  /** 孩子真实做错的题(最多两道),让新题贴近他犯错的方式。 */
  examples: { question: string; studentAnswer: string }[];
  /** 之前已经出过的题,新题不要重复。 */
  avoid: string[];
  count: number;
};

/** 出变式题:同一个知识点和错误原因,换数值或情境。 */
export function buildGenerateMessages(input: GenerateInput): ChatMessage[] {
  const examples = input.examples
    .map(
      (e, i) =>
        `例${i + 1}:${e.question}(孩子的错误答案:${e.studentAnswer || '未作答'})`,
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
      "solution_markdown": "简短的解题思路"
    }
  ]
}

要求:
1. 出 ${input.count} 道题,考查同一个知识点,针对同一种错误原因,但数值和情境要和例题不同,题与题之间也不要重复。
2. 题型只能是两种:choice(选择题,必须给 4 个选项,干扰项要对应孩子可能的典型错误)和 number(计算题或应用题,孩子只输入最终结果,不写过程)。两种题型都要有。
3. number 题的答案必须是唯一确定的数:整数、小数、最简分数(写成 a/b),或带余数的除法(写成 商...余数)。不要出答案不唯一的题,也不要要求写过程。
4. 难度和孩子的年级相当,不要超纲。题目表述要清楚完整,不依赖图形。
5. correct_answer 必须是你仔细算出的正确结果。`;

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
      content: `你是一位严谨的小学数学老师。请独立解答下面的题目,仔细检查后再作答。只返回一个 JSON 对象:{"answer": "..."},不要输出其他文字。${how}`,
    },
    { role: 'user', content: `${question.questionMarkdown}${options}` },
  ];
}
