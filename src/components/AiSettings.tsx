import { useEffect, useState } from 'react';
import { PROVIDERS, type ProviderId } from '../shared/providers';
import type { Settings } from '../shared/settings';

const CUSTOM = '__custom__';
const GRADES = ['一', '二', '三', '四', '五', '六'];

const inputClass =
  'h-12 w-full rounded-2xl bg-black/20 px-4 text-white outline-none ring-1 ring-white/20 placeholder:text-white/40 focus:ring-2 focus:ring-mint';
const buttonClass =
  'h-12 shrink-0 rounded-full bg-white/20 px-6 font-semibold ring-1 ring-white/30 transition hover:bg-white/30 disabled:opacity-50';

type Notice = { tone: 'ok' | 'error'; text: string } | null;

function NoticeText({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p
      role="status"
      className={`mt-3 text-sm ${notice.tone === 'ok' ? 'text-mint' : 'text-sun'}`}
    >
      {notice.text}
    </p>
  );
}

export function AiSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keyStatus, setKeyStatus] = useState<Record<ProviderId, boolean>>({
    qwen: false,
  });
  const [keyInput, setKeyInput] = useState('');
  const [keyNotice, setKeyNotice] = useState<Notice>(null);
  const [saveNotice, setSaveNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.api.getSettings().then(setSettings);
    void window.api.getKeyStatus().then(setKeyStatus);
  }, []);

  if (!settings) return null;

  const provider = PROVIDERS[settings.provider];
  const hasKey = keyStatus[settings.provider];
  const isPreset = provider.models.some((m) => m.id === settings.model);
  const preset = provider.models.find((m) => m.id === settings.model);

  const update = (patch: Partial<Settings>) => {
    setSettings({ ...settings, ...patch });
    setSaveNotice(null);
  };

  const saveKey = async () => {
    setBusy(true);
    const res = await window.api.setApiKey({
      provider: settings.provider,
      key: keyInput,
    });
    setBusy(false);
    if (!res.ok) return setKeyNotice({ tone: 'error', text: res.error });
    setKeyInput('');
    const status = await window.api.getKeyStatus();
    setKeyStatus(status);
    setKeyNotice({
      tone: 'ok',
      text: status[settings.provider] ? '密钥已加密保存' : '密钥已清除',
    });
  };

  const testKey = async () => {
    setBusy(true);
    setKeyNotice({ tone: 'ok', text: '验证中…' });
    const res = await window.api.testApiKey({
      provider: settings.provider,
      model: settings.model,
    });
    setBusy(false);
    setKeyNotice(
      res.ok
        ? { tone: 'ok', text: '连接正常:Key 和所选模型都可用' }
        : { tone: 'error', text: res.error },
    );
  };

  const saveSettings = async () => {
    setBusy(true);
    const res = await window.api.saveSettings(settings);
    setBusy(false);
    if (!res.ok) return setSaveNotice({ tone: 'error', text: res.error });
    setSettings(res.value);
    setSaveNotice({ tone: 'ok', text: '已保存' });
  };

  return (
    <section className="mt-8 max-w-xl rounded-3xl bg-white/10 p-6 ring-1 ring-white/15">
      <h2 className="text-lg font-semibold">AI 识别设置</h2>
      <p className="mt-1 text-sm text-white/60">
        错题照片会发送给{provider.shortName}。拍照时请避开孩子的姓名和学校。
      </p>

      <label className="mt-6 block text-sm text-white/80" htmlFor="api-key">
        {provider.shortName} API Key
        {hasKey && <span className="ml-2 text-mint">已设置</span>}
      </label>
      <div className="mt-2 flex gap-3">
        <input
          id="api-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder={hasKey ? '已保存,如需更换请重新输入' : 'sk-...'}
          className={inputClass}
        />
        <button
          type="button"
          onClick={saveKey}
          disabled={busy || (!keyInput.trim() && !hasKey)}
          className={buttonClass}
        >
          {keyInput.trim() || !hasKey ? '保存' : '清除'}
        </button>
        <button
          type="button"
          onClick={testKey}
          disabled={busy || !hasKey}
          className={buttonClass}
        >
          验证
        </button>
      </div>
      <p className="mt-2 text-xs text-white/50">
        {provider.keyHelp}密钥只写入、不回显,用系统钥匙串加密保存在本机。
      </p>
      <NoticeText notice={keyNotice} />

      <label className="mt-6 block text-sm text-white/80" htmlFor="model">
        识别与分析模型
      </label>
      <select
        id="model"
        value={isPreset ? settings.model : CUSTOM}
        onChange={(e) =>
          update({ model: e.target.value === CUSTOM ? '' : e.target.value })
        }
        className={`${inputClass} mt-2 appearance-none`}
      >
        {provider.models.map((m) => (
          <option key={m.id} value={m.id} className="text-ink">
            {m.label}
          </option>
        ))}
        <option value={CUSTOM} className="text-ink">
          自定义模型 ID…
        </option>
      </select>
      {preset && (
        <p className="mt-2 text-xs text-white/50">
          {preset.note}。价格请以服务商官网为准。
        </p>
      )}
      {!isPreset && (
        <input
          aria-label="自定义模型 ID"
          value={settings.model}
          onChange={(e) => update({ model: e.target.value })}
          placeholder={`填写${provider.shortName}的模型 ID,需支持图片输入`}
          className={`${inputClass} mt-3`}
        />
      )}

      <label className="mt-6 block text-sm text-white/80" htmlFor="grade">
        孩子的年级
      </label>
      <select
        id="grade"
        value={settings.grade}
        onChange={(e) => update({ grade: Number(e.target.value) })}
        className={`${inputClass} mt-2 appearance-none`}
      >
        {GRADES.map((name, i) => (
          <option key={name} value={i + 1} className="text-ink">
            {name}年级(人教版)
          </option>
        ))}
      </select>

      <div className="mt-6 flex items-center gap-4">
        <button
          type="button"
          onClick={saveSettings}
          disabled={busy || !settings.model.trim()}
          className={buttonClass}
        >
          保存设置
        </button>
        <span className="text-xs text-white/50">
          切换服务商或模型后,点「保存设置」才会生效
        </span>
      </div>
      <NoticeText notice={saveNotice} />
    </section>
  );
}
