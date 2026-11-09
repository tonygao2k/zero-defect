import { useEffect, useState } from 'react';
import type { UpdateCheckResult } from '../shared/ipc';

type CheckState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'done'; result: UpdateCheckResult };

function resultText(result: UpdateCheckResult): string {
  switch (result.status) {
    case 'update_available':
      return `发现新版本 ${result.latest}`;
    case 'up_to_date':
      return '已是最新版本';
    case 'no_release':
      return '暂时还没有发布的新版本';
    case 'error':
      return result.message;
  }
}

// TODO: 家长验证(verifyParentGate)接通后,这个页面要放在验证之后。
export function ParentPage() {
  const [version, setVersion] = useState('');
  const [check, setCheck] = useState<CheckState>({ phase: 'idle' });

  useEffect(() => {
    void window.api.getAppVersion().then(setVersion);
  }, []);

  const runCheck = async () => {
    setCheck({ phase: 'checking' });
    const result = await window.api.checkForUpdate();
    setCheck({ phase: 'done', result });
  };

  const checking = check.phase === 'checking';

  return (
    <div className="h-full overflow-y-auto px-12 pb-10 pt-16">
      <h1 className="text-4xl font-semibold">家长入口</h1>

      <section className="mt-8 max-w-xl rounded-3xl bg-white/10 p-6 ring-1 ring-white/15">
        <h2 className="text-lg font-semibold">关于</h2>
        <p className="mt-2 text-white/75">当前版本 {version || '…'}</p>

        <div className="mt-5 flex items-center gap-4">
          <button
            type="button"
            onClick={runCheck}
            disabled={checking}
            className="h-12 rounded-full bg-white/20 px-6 font-semibold ring-1 ring-white/30 transition hover:bg-white/30 disabled:opacity-60"
          >
            {checking ? '检查中…' : '检查更新'}
          </button>

          {check.phase === 'done' && (
            <>
              <span
                role="status"
                className={
                  check.result.status === 'error'
                    ? 'text-sun'
                    : check.result.status === 'update_available'
                      ? 'font-semibold text-mint'
                      : 'text-white/80'
                }
              >
                {resultText(check.result)}
              </span>
              {check.result.status === 'update_available' && (
                <button
                  type="button"
                  onClick={() => void window.api.openReleasePage()}
                  className="h-12 rounded-full bg-gradient-to-b from-[#b6ffd8] to-[#22c97a] px-6 font-bold text-ink"
                >
                  前往下载
                </button>
              )}
            </>
          )}
        </div>

        <p className="mt-4 text-xs text-white/50">
          只在点击时联网查询 GitHub,不会自动检查,也不会上传任何学习数据。
        </p>
      </section>
    </div>
  );
}
