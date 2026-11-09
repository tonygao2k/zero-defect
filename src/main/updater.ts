import { app, net } from 'electron';
import { z } from 'zod';
import { GITHUB_REPO } from '../shared/app-info';
import type { UpdateCheckResult } from '../shared/ipc';
import { compareVersions } from '../shared/version';

const ReleaseSchema = z.object({ tag_name: z.string() });

const REQUEST_TIMEOUT_MS = 10_000;

/** 只在家长手动点击时调用:查询 GitHub 最新正式发布版本并与当前版本比较。 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const current = app.getVersion();
  try {
    const res = await net.fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'zero-defect-update-check',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    // 仓库还没有任何正式发布时,GitHub 返回 404。
    if (res.status === 404) return { status: 'no_release', current };
    if (!res.ok) {
      const message =
        res.status === 403 || res.status === 429
          ? '请求太频繁,请稍后再试'
          : `服务器返回了 ${res.status},请稍后再试`;
      return { status: 'error', current, message };
    }

    const release = ReleaseSchema.parse(await res.json());
    const cmp = compareVersions(release.tag_name, current);
    if (cmp === null) {
      return {
        status: 'error',
        current,
        message: `无法识别版本号 ${release.tag_name}`,
      };
    }
    return cmp > 0
      ? { status: 'update_available', current, latest: release.tag_name }
      : { status: 'up_to_date', current };
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? '返回的内容格式不对,请稍后再试'
        : '无法连接到 GitHub,请检查网络';
    return { status: 'error', current, message };
  }
}
