import type { Api, UpdateCheckResult } from '../shared/ipc';

export type AvailableUpdate = Extract<
  UpdateCheckResult,
  { status: 'update_available' }
>;

const STARTUP_DELAY = 5_000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1_000;

/** 每次启动延迟检查,之后每 6 小时检查;同一版本本次运行只提醒一次。 */
export function startAutomaticUpdateCheck(
  check: Api['checkForUpdate'],
  onAvailable: (update: AvailableUpdate) => void,
) {
  let stopped = false;
  const notified = new Set<string>();
  let timer: ReturnType<typeof setTimeout>;

  async function run() {
    try {
      const result = await check();
      if (
        !stopped &&
        result.status === 'update_available' &&
        !notified.has(result.latest)
      ) {
        notified.add(result.latest);
        onAvailable(result);
      }
    } catch {
      // 自动检查失败不打扰使用,下一周期重试;手动检查仍显示错误。
    } finally {
      if (!stopped) timer = setTimeout(run, CHECK_INTERVAL);
    }
  }

  timer = setTimeout(run, STARTUP_DELAY);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
