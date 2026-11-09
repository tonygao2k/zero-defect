import { z } from 'zod';
import {
  DEFAULT_PROVIDER,
  PROVIDER_IDS,
  ProviderIdSchema,
  defaultModelFor,
} from './providers';

const BaseSettingsSchema = z.object({
  provider: ProviderIdSchema.default(DEFAULT_PROVIDER),
  model: z.string().trim().min(1).default(defaultModelFor(DEFAULT_PROVIDER)),
  grade: z.number().int().min(1).max(6).default(3),
  curriculumId: z.string().min(1).default('pep_primary_math'),
  confidenceThreshold: z.number().min(0).max(1).default(0.7),
  dailyQuestionCount: z.number().int().min(3).max(5).default(3),
});

/**
 * 旧设置文件里可能记着已经移除的服务商(如 kimi)。此时丢掉 provider 和 model,
 * 回退到默认服务商和它的默认模型,其余设置(年级等)保留。
 */
function dropRetiredProvider(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const obj = raw as Record<string, unknown>;
  if (
    obj.provider === undefined ||
    PROVIDER_IDS.includes(obj.provider as never)
  ) {
    return raw;
  }
  const { provider: _provider, model: _model, ...rest } = obj;
  return rest;
}

/** 家长设置。API Key 不在这里,它只写不读,按服务商分别加密保存。 */
export const SettingsSchema = z.preprocess(
  dropRetiredProvider,
  BaseSettingsSchema,
);

export type Settings = z.infer<typeof BaseSettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
