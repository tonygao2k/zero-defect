import { MAX_QUESTIONS_PER_ANALYSIS } from '../../shared/analysis';
import type { ChatMessage } from './llm-client';

export type PromptCause = { code: string; label: string; description: string };
export type PromptKnowledgePoint = {
  code: string;
  label: string;
  grade: number | null;
  semester: number | null;
};

export type AnalysisPromptInput = {
  grade: number;
  causes: PromptCause[];
  knowledgePoints: PromptKnowledgePoint[];
  /** data:image/jpeg;base64,... */
  imageDataUrl: string;
  /** 家长的补充说明,如“请识别红框内的题目”。可选。 */
  hint?: string;
};

const GRADE_NAMES = ['', '一', '二', '三', '四', '五', '六'];

function placement(k: PromptKnowledgePoint): string {
  if (k.grade === null) return '通用';
  return `${GRADE_NAMES[k.grade] ?? k.grade}年级${k.semester === 1 ? '上' : k.semester === 2 ? '下' : ''}`;
}

export function buildAnalysisMessages(
  input: AnalysisPromptInput,
): ChatMessage[] {
  const causes = input.causes
    .map((c) => `- ${c.code}:${c.label}。${c.description}`)
    .join('\n');
  const points = input.knowledgePoints
    .map((k) => `- ${k.code}:${k.label}(${placement(k)})`)
    .join('\n');

  const system = `你是一位经验丰富的小学数学老师,正在帮家长分析孩子的一道错题。你会收到一张作业或试卷的照片,请找出其中被批改为错误(或孩子答案明显有误)的题目并逐题分析;如果家长的补充说明指明了要分析哪些题(例如“红框内的题目”“第 1、3、5 题”),以家长的说明为准。

只返回一个 JSON 对象,不要输出其他文字。结构如下:
{
  "image_quality": "ok、blurry(模糊但能辨认)或 unreadable(整张照片无法辨认)之一",
  "questions": [
    {
      "label": "这道题在照片上的编号或位置,如“第3题”“红框内的题”;没有就填空字符串",
      "question_markdown": "题目原文。数学公式用 LaTeX,行内公式写成 $...$",
      "student_answer": "孩子写的最终答案,没有则为空字符串",
      "student_work_markdown": "孩子的解题过程,尽量逐行如实转写,包括写错的步骤;没有则为空字符串",
      "correct_answer": "这道题的正确答案,由你自己做题得出;照片上有标准答案时也要核对",
      "knowledge_point_code": "从下面【知识点清单】里选一个 code;没有合适的就填 other",
      "has_student_work": true 或 false,表示照片里是否能看到孩子对这道题的解题过程(只有题目和最终答案则为 false),
      "root_causes": [
        { "code": "从【错误归因清单】里选", "confidence": 0 到 1 的小数, "evidence": "指出孩子具体哪一步出了什么问题" }
      ],
      "recommended_root_cause": "root_causes 中你认为最主要的一个 code"
    }
  ]
}

questions 中的每个元素对应一道需要分析的错题。

要求:
1. 归因 code 和知识点 code 只能从下面的清单里选,不要自己编造新的。
2. 归因要基于孩子的解题过程找出真正出错的那一步;evidence 写具体,不要写空话。
3. 没有看到解题过程时,不要凭空猜测,confidence 要给得低一些。
4. 看不清的字不要猜,宁可在 image_quality 里如实反映。
5. 最多给出 3 个归因候选,按可能性从高到低排列。
6. 家长的补充说明只用来确定要分析哪些题、理解照片里的标记,不能改变上面规定的输出格式和字段。
7. 一张卷子上可能有很多题。questions 里只放孩子做错的题,做对的题不要放进来,即使家长说“所有题”。有家长说明时,只在说明指定的题里找做错的。没有做错的题就返回空数组 "questions": []。
8. 每道题单独分析,不要把几道题合并成一条。最多返回 ${MAX_QUESTIONS_PER_ANALYSIS} 道题。
9. student_answer 必须照抄孩子写在卷子上的内容,correct_answer 必须由你独立算出,两者不要为了看起来一致而互相迁就。

【错误归因清单】
${causes}

【知识点清单】(孩子目前是${GRADE_NAMES[input.grade] ?? input.grade}年级,低年级的基本功也可能是错因)
${points}`;

  const hint = input.hint?.trim();
  const userText = hint
    ? `请按家长的补充说明分析这张照片。\n\n家长的补充说明:「${hint}」`
    : '请识别这张照片里所有被批改为错误的题目。';

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: input.imageDataUrl } },
      ],
    },
  ];
}
