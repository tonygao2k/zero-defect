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
  /** 按页序排列的图片,data:image/jpeg;base64,... */
  imageDataUrls: string[];
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

  const pageCount = input.imageDataUrls.length;
  const system = `你是一位经验丰富的小学数学老师,正在帮家长分析孩子试卷上的错题。你会按页码顺序收到同一份作业或试卷的 ${pageCount} 张照片,请找出整份试卷里孩子做错的题和没有做的题,逐题分析。

只返回一个 JSON 对象,不要输出其他文字。结构如下:
{
  "image_quality": "ok、blurry(模糊但能辨认)或 unreadable(照片无法辨认)之一",
  "questions": [
    {
      "label": "这道题的编号或位置,如“第3题”;没有就填空字符串",
      "pages": [这道题出现在第几页,从 1 开始;跨页的题列出所有页],
      "incomplete": true 或 false,题干或解题过程在页边被截断、而相邻页里又找不到后半部分时为 true,
      "question_markdown": "题目原文。数学公式用 LaTeX,行内公式写成 $...$",
      "student_answer": "孩子写的最终答案;没有作答则为空字符串",
      "student_work_markdown": "孩子的解题过程,尽量逐行如实转写,包括写错的步骤;没有则为空字符串",
      "correct_answer": "这道题的正确答案,由你自己做题得出;照片上有标准答案时也要核对",
      "knowledge_point_code": "从下面【知识点清单】里选一个 code;没有合适的就填 other",
      "has_student_work": true 或 false,表示能否看到孩子对这道题的解题过程(只有题目和最终答案则为 false),
      "root_causes": [
        { "code": "从【错误归因清单】里选", "confidence": 0 到 1 的小数, "evidence": "指出孩子具体哪一步出了什么问题" }
      ],
      "recommended_root_cause": "root_causes 中你认为最主要的一个 code",
      "figure_kind": "这道题带的图属于哪一类:none(没有图)、cube_net(正方体展开图)、number_line(数轴)、bar_chart(条形统计图)、cube_stack(小正方体搭的立体图形,问从某个方向看)、other(其他图,如几何图形、线段图、情境图)",
      "figure_note": "有图时用一句话写出图的特点,如“由 6 个带字的格子组成的展开图,问哪两个字相对”“数轴上标了 A、B 两点,问 A 表示的小数”;没有图填空字符串"
    }
  ]
}

要求:
1. questions 里放:被批改为错误的题、答案明显有误的题、孩子没有作答的题(student_answer 填空字符串)。做对的题一律不要放进来。没有这样的题就返回空数组 "questions": []。
2. 每道题单独分析,不要把几道题合并成一条。最多返回 ${MAX_QUESTIONS_PER_ANALYSIS} 道题。
3. 一道题的题干、图或孩子的解题过程可能跨在相邻两页上,要把它们合成同一道题,pages 列出所有相关页。
4. 归因 code 和知识点 code 只能从下面的清单里选,不要自己编造新的。孩子没有作答的题,归因选 not_attempted。
5. 归因要基于孩子的解题过程找出真正出错的那一步;evidence 写具体,不要写空话。没有看到解题过程时不要凭空猜测,confidence 要给得低一些。
6. 看不清的字不要猜,宁可在 image_quality 里如实反映。最多给出 3 个归因候选,按可能性从高到低排列。
7. 题目里带图时,要如实填写 figure_kind 和 figure_note,题目文字里写“如图”但你看到的是图,不要省略。图里的关键信息(数据、字、位置)写进 question_markdown。
8. student_answer 必须照抄孩子写在卷子上的内容,correct_answer 必须由你独立算出,两者不要为了看起来一致而互相迁就。

【错误归因清单】
${causes}

【知识点清单】(孩子目前是${GRADE_NAMES[input.grade] ?? input.grade}年级,低年级的基本功也可能是错因)
${points}`;

  const userText =
    pageCount > 1
      ? `这是同一份试卷的 ${pageCount} 页,按页码从第 1 页到第 ${pageCount} 页依次给出。请找出所有做错和没做的题。`
      : '请找出这张照片里所有做错和没做的题。';

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'text', text: userText },
        ...input.imageDataUrls.map((url) => ({
          type: 'image_url' as const,
          image_url: { url },
        })),
      ],
    },
  ];
}
