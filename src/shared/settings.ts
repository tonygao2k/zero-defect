import { z } from 'zod';

export const DEFAULT_PRACTICE_QUESTION_COUNT = 5;
export const MAX_PRACTICE_QUESTION_COUNT = 10;

export const SettingsSchema = z.object({
  grade: z.number().int().min(1).max(6).default(3),
  semester: z.union([z.literal(1), z.literal(2)]).default(1),
  curriculumId: z.string().min(1).default('pep_primary_math'),
  confidenceThreshold: z.number().min(0).max(1).default(0.7),
  practiceDifficulty: z
    .union([z.literal('easy'), z.literal('medium'), z.literal('hard')])
    .default('medium'),
  practiceQuestionCount: z
    .number()
    .int()
    .min(1)
    .max(MAX_PRACTICE_QUESTION_COUNT)
    .default(DEFAULT_PRACTICE_QUESTION_COUNT),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
