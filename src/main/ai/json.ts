/**
 * 从模型输出文本里取出 JSON 对象。模型常把 JSON 包在 ```json 代码块里,
 * 或在前后加一句说明,所以先去掉围栏,再截取第一个 { 到最后一个 }。
 * 解析失败返回 null,由调用方决定是否重试。
 */
export function extractJson(text: string): unknown | null {
  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
}
