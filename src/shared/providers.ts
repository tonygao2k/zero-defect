import { z } from 'zod';

/**
 * 目前只支持通义千问。Kimi 经实测会误识别手写题,已移除。
 * 保留“服务商”这一层,是因为 API 地址、Key 和模型预设本来就按服务商组织,
 * 以后要加别家,在这里加一项即可。
 */
export const ProviderIdSchema = z.enum(['qwen']);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export type ModelPreset = {
  id: string;
  label: string;
  /** 给家长看的一句话说明。不写价格:价格会变,请以服务商官网为准。 */
  note: string;
};

export type Provider = {
  id: ProviderId;
  label: string;
  /** 简称,用在错误提示里,如“通义千问”。 */
  shortName: string;
  /** OpenAI 兼容接口的基础地址(中国大陆可直连)。 */
  baseUrl: string;
  /** 在哪里获取 Key,显示在设置页。 */
  keyHelp: string;
  models: ModelPreset[];
};

/**
 * 模型 ID 来自阿里云官方文档或公开资料,服务商会调整型号,
 * 设置页的“验证”按钮会用所选模型真实请求一次,能提前发现型号不可用。
 */
export const PROVIDERS: Record<ProviderId, Provider> = {
  qwen: {
    id: 'qwen',
    label: '通义千问(阿里云百炼)',
    shortName: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keyHelp: '在阿里云百炼控制台创建 API Key(北京地域)。',
    models: [
      {
        id: 'qwen3-vl-plus',
        label: 'Qwen3-VL Plus(默认)',
        note: '视觉专用型号,实测能找全错题,偶尔会读错孩子的答案,比 Flash 慢、价格更高',
      },
      {
        id: 'qwen3.8-flash',
        label: 'Qwen3.8 Flash',
        note: '便宜、速度快,实测较稳但会漏掉个别错题',
      },
    ],
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export const DEFAULT_PROVIDER: ProviderId = 'qwen';

export function defaultModelFor(provider: ProviderId): string {
  return PROVIDERS[provider].models[0].id;
}
