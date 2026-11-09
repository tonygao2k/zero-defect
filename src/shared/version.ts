/** 解析 "v1.2.3" 或 "1.2.3-beta.1" 的主版本号部分,失败返回 null。 */
export function parseVersion(input: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(input.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** a 比 b 新返回正数,相同返回 0,更旧返回负数。任一方无法解析时返回 null。 */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}
