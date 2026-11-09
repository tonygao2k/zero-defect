import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER,
  PROVIDERS,
  PROVIDER_IDS,
  defaultModelFor,
} from './providers';
import { DEFAULT_SETTINGS, SettingsSchema } from './settings';

describe('providers', () => {
  it('only uses https base URLs without a trailing slash', () => {
    for (const p of Object.values(PROVIDERS)) {
      expect(p.baseUrl).toMatch(/^https:\/\//);
      expect(p.baseUrl.endsWith('/')).toBe(false);
    }
  });

  it('has a consistent id, at least one model, and unique model ids', () => {
    for (const id of PROVIDER_IDS) {
      expect(PROVIDERS[id].id).toBe(id);
      const ids = PROVIDERS[id].models.map((m) => m.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('supports only Qwen', () => {
    expect(PROVIDER_IDS).toEqual(['qwen']);
  });

  it('does not depend on OpenRouter or any overseas relay', () => {
    for (const p of Object.values(PROVIDERS))
      expect(p.baseUrl).not.toMatch(/openrouter/i);
  });
});

describe('settings schema', () => {
  it('defaults to the default provider and its first model', () => {
    expect(DEFAULT_SETTINGS.provider).toBe(DEFAULT_PROVIDER);
    expect(DEFAULT_SETTINGS.model).toBe(defaultModelFor(DEFAULT_PROVIDER));
  });

  it('upgrades an old OpenRouter-era settings file to the defaults for provider and model', () => {
    const old = { visionModel: 'openai/gpt-6.1-sol', grade: 5 };
    const parsed = SettingsSchema.parse(old);
    expect(parsed.grade).toBe(5);
    expect(parsed.provider).toBe(DEFAULT_PROVIDER);
    expect(parsed.model).toBe(defaultModelFor(DEFAULT_PROVIDER));
    expect(parsed).not.toHaveProperty('visionModel');
  });

  it('falls back to the default provider and model when the saved provider was retired', () => {
    const parsed = SettingsSchema.parse({
      provider: 'kimi',
      model: 'kimi-k3',
      grade: 4,
    });
    expect(parsed.provider).toBe(DEFAULT_PROVIDER);
    expect(parsed.model).toBe(defaultModelFor(DEFAULT_PROVIDER));
    expect(parsed.grade).toBe(4);
  });

  it('keeps the saved model while the provider is still supported', () => {
    const parsed = SettingsSchema.parse({
      provider: 'qwen',
      model: 'qwen3-vl-plus',
    });
    expect(parsed.model).toBe('qwen3-vl-plus');
  });
});
