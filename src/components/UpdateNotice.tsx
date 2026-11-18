import { useEffect, useState } from 'react';
import {
  startAutomaticUpdateCheck,
  type AvailableUpdate,
} from '../platform/automatic-updates';
import { btn, Note } from './ui';

export function UpdateNotice() {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');

  useEffect(
    () =>
      startAutomaticUpdateCheck(
        () => window.api.checkForUpdate(),
        (result) => {
          setUpdate(result);
          setError('');
        },
      ),
    [],
  );

  async function download() {
    setOpening(true);
    setError('');
    try {
      await window.api.openReleasePage();
    } catch {
      setError('无法打开下载页面,请稍后重试');
    } finally {
      setOpening(false);
    }
  }

  if (!update) return null;

  return (
    <section
      aria-label="版本更新提醒"
      className="fixed bottom-6 right-6 z-50 w-96 max-w-[calc(100vw-3rem)] rounded-3xl border border-mint/30 bg-[#104b38] p-5 text-white shadow-2xl"
    >
      <div role="status" aria-live="polite" aria-atomic="true">
        <p className="font-semibold text-mint">发现新版本 {update.latest}</p>
        <p className="mt-2 text-sm text-white/75">
          当前版本 {update.current},可前往发布页下载安装。
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className={btn.small}
          onClick={() => void download()}
          disabled={opening}
        >
          {opening ? '打开中…' : '前往下载'}
        </button>
        <button
          type="button"
          className={btn.small}
          onClick={() => setUpdate(null)}
        >
          稍后再说
        </button>
      </div>
      {error && (
        <div className="mt-3">
          <Note tone="error">{error}</Note>
        </div>
      )}
    </section>
  );
}
