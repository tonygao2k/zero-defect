import { z } from 'zod';

export type MistakeStatus = 'draft' | 'active' | 'unattributed' | 'archived';

/** 家长在确认页可以修改的内容(设计文档 3.2:题目、学生答案、标准答案均可编辑)。 */
export const EditableFieldsSchema = z.object({
  mistakeId: z.string().min(1),
  questionMarkdown: z.string().trim().min(1, '题目不能为空'),
  studentAnswer: z.string().trim(),
  studentWorkMarkdown: z.string().trim(),
  correctAnswer: z.string().trim(),
  knowledgePointCode: z.string().min(1),
});

export const ConfirmMistakeSchema = EditableFieldsSchema.extend({
  rootCauseCode: z.string().min(1),
});

export type EditableFields = z.infer<typeof EditableFieldsSchema>;
export type ConfirmMistakeInput = z.infer<typeof ConfirmMistakeSchema>;

export type MistakeSummary = {
  id: string;
  status: MistakeStatus;
  questionMarkdown: string;
  knowledgePointLabel: string | null;
  primaryRootCauseLabel: string | null;
  createdAt: string;
};
