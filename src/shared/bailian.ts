/**
 * 模型接入(设计文档技术表):统一使用阿里云百炼,所有模型共用一个 API Key。
 * 模型由系统内部固定,家长只需要填 Key,不能选模型,避免误选影响效果。
 */
export const BAILIAN = {
  label: '阿里云百炼',
  /** 用在错误提示里。 */
  shortName: '通义千问',
  /** OpenAI 兼容接口的基础地址(中国大陆可直连)。 */
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  keyHelp: '在阿里云百炼控制台(bailian.console.aliyun.com)创建 API Key。',
} as const;

/** 识别试卷、判对错、归因。用真实卷子对比后再决定是否换成 qwen-vl-ocr 降本。 */
export const RECOGNITION_MODEL = 'qwen3-vl-plus';

/** 生成变式题,以及独立求解来校验答案。 */
export const TEXT_MODEL = 'qwen3.8-flash';
