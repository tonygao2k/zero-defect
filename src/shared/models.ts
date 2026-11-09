export type ModelPreset = {
  id: string;
  label: string;
  /** 美元/百万 token,输入 / 输出。 */
  price: string;
  note: string;
};

/**
 * 识别与归因分析模型预设。ID 和价格抄自 OpenRouter 模型列表(2026-11-09 快照),
 * 价格会变,以 OpenRouter 实时价格为准。两者都支持图片输入和推理。
 * 用户也可以在设置里填写任意模型 ID。
 */
export const VISION_MODEL_PRESETS: ModelPreset[] = [
  {
    id: 'openai/gpt-6.1-sol',
    label: 'GPT-6.1 Sol',
    price: '$2 / $10',
    note: '效果优先,识别手写和归因判断更稳',
  },
  {
    id: 'qwen/qwen3.8-flash',
    label: 'Qwen3.8 Flash(通义千问)',
    price: '$0.15 / $0.47',
    note: '国产,价格约为 Sol 的十分之一以下,中文识别见长',
  },
];

export const DEFAULT_VISION_MODEL = 'openai/gpt-6.1-sol';
