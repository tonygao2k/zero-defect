import { z } from 'zod';

/**
 * 家长设置:只有年级和上/下学期(设计文档第六章)。API Key 不在这里,存在数据库里且只写不读。
 * 旧设置文件里的 provider、model 等字段会被忽略。
 */
export const SettingsSchema = z.object({
  grade: z.number().int().min(1).max(6).default(3),
  semester: z.union([z.literal(1), z.literal(2)]).default(1),
  curriculumId: z.string().min(1).default('pep_primary_math'),
  confidenceThreshold: z.number().min(0).max(1).default(0.7),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
