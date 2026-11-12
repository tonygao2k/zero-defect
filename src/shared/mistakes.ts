import { z } from 'zod';

/**
 * draft = 待确认,active = 已确认。
 * unattributed / archived 是旧版本留下的状态,新流程不再产生;unattributed 按待确认处理。
 */
export type MistakeStatus = 'draft' | 'active' | 'unattributed' | 'archived';

/** 家长在详情页可以修改的内容。 */
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
  paperId: string | null;
  questionMarkdown: string;
  knowledgePointLabel: string | null;
  primaryRootCauseLabel: string | null;
  /** 题目被页边截断,需要补传缺页。 */
  incomplete: boolean;
  /** 归因把握不高、缺少解题过程等,需要家长仔细核对。 */
  needsAttention: boolean;
  createdAt: string;
};

export const ListMistakesSchema = z
  .object({
    status: z.enum(['pending', 'confirmed']).optional(),
    paperId: z.string().min(1).optional(),
  })
  .optional();
export type ListMistakesInput = z.infer<typeof ListMistakesSchema>;

export type BatchConfirmResult = { confirmed: number; skipped: number };
