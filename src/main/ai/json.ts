/**
 * 从模型输出文本里取出 JSON 对象。模型常把 JSON 包在 ```json 代码块里,
 * 或在前后加一句说明,所以先去掉围栏,再截取第一个 { 到最后一个 }。
 * 模型有时先写一大段带 LaTeX 的推理(里面也有花括号)再给 JSON,整段截取会解析失败,
 * 这时改为逐个找花括号配对的片段,取最后一个能解析成对象的。
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
    return lastJsonObject(unfenced);
  }
}

/** 按花括号配对切出顶层片段(字符串里的括号不算),返回最后一个能解析成对象的。 */
function lastJsonObject(text: string): unknown | null {
  let found: unknown | null = null;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inString = false;
    let j = i;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (ch === '\\') j++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) break;
    }
    if (depth !== 0) continue;
    try {
      const value: unknown = JSON.parse(text.slice(i, j + 1));
      if (typeof value === 'object' && value !== null) found = value;
      i = j;
    } catch {
      // 不是 JSON(比如 LaTeX 的 \begin{array}),往后继续找。
    }
  }
  return found;
}
