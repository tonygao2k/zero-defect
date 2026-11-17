/**
 * 模型接入(设计文档技术表):统一使用阿里云百炼,所有模型共用一个 API Key。
 * 模型由 Rust 端配置统一管理,家长只需要填 Key,不能选模型,避免误选影响效果。
 */
export const BAILIAN = {
  label: '阿里云百炼',
  /** 用在错误提示里。 */
  shortName: '通义千问',
  keyHelp: '在阿里云百炼控制台(bailian.console.aliyun.com)创建 API Key。',
} as const;
