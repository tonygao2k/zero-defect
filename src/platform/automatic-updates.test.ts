import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateCheckResult } from '../shared/ipc';
import { startAutomaticUpdateCheck } from './automatic-updates';

const interval = 6 * 60 * 60 * 1_000;
const available: UpdateCheckResult = {
  status: 'update_available',
  current: '1.0.2',
  latest: 'v1.0.3',
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('automatic update checks', () => {
  it('waits for startup, checks periodically and notifies once per version', async () => {
    const check = vi.fn().mockResolvedValue(available);
    const notify = vi.fn();
    const stop = startAutomaticUpdateCheck(check, notify);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(notify).toHaveBeenCalledWith(available);
    await vi.advanceTimersByTimeAsync(interval);
    expect(check).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(1);
    check.mockResolvedValue({ ...available, latest: 'v1.0.4' });
    await vi.advanceTimersByTimeAsync(interval);
    expect(notify).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(interval);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it.each<UpdateCheckResult>([
    { status: 'up_to_date', current: '1.0.2' },
    { status: 'no_release', current: '1.0.2' },
    { status: 'error', current: '1.0.2', message: '网络不可用' },
  ])('ignores $status and retries later', async (result) => {
    const check = vi
      .fn()
      .mockResolvedValueOnce(result)
      .mockResolvedValue(available);
    const notify = vi.fn();
    const stop = startAutomaticUpdateCheck(check, notify);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(interval);
    expect(notify).toHaveBeenCalledWith(available);
    stop();
  });

  it('silently handles rejected IPC calls and retries', async () => {
    const check = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(available);
    const notify = vi.fn();
    const stop = startAutomaticUpdateCheck(check, notify);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(interval);
    expect(notify).toHaveBeenCalledWith(available);
    stop();
  });

  it('cancels the initial timer on cleanup, including StrictMode remounts', async () => {
    const check = vi.fn().mockResolvedValue(available);
    const notify = vi.fn();
    startAutomaticUpdateCheck(check, notify)();
    const stop = startAutomaticUpdateCheck(check, notify);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(check).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not overlap requests or publish late results after cleanup', async () => {
    let resolve!: (result: UpdateCheckResult) => void;
    const check = vi.fn(
      () =>
        new Promise<UpdateCheckResult>((done) => {
          resolve = done;
        }),
    );
    const notify = vi.fn();
    const stop = startAutomaticUpdateCheck(check, notify);
    await vi.advanceTimersByTimeAsync(5_000 + interval);
    expect(check).toHaveBeenCalledTimes(1);
    stop();
    resolve(available);
    await vi.advanceTimersByTimeAsync(interval);
    expect(notify).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
