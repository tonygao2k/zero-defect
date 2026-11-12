import { useEffect, useState } from 'react';
import { Note, Page, btn, inputClass } from '../components/ui';
import { BAILIAN } from '../shared/bailian';
import type { UpdateCheckResult } from '../shared/ipc';
import type { Settings } from '../shared/settings';

const GRADES = ['一', '二', '三', '四', '五', '六'];

type Msg = { tone: 'ok' | 'error' | 'info'; text: string } | null;

function updateText(result: UpdateCheckResult): string {
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

function Card(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="max-w-xl rounded-3xl bg-white/10 p-6 ring-1 ring-white/15">
      <h2 className="text-lg font-semibold">{props.title}</h2>
      {props.children}
    </section>
  );
}

function KeyCard() {
  const [hasKey, setHasKey] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    void window.api.hasApiKey().then(setHasKey);
  }, []);

  const save = async () => {
    setBusy(true);
    const res = await window.api.setApiKey({ key: input });
    setBusy(false);
    if (!res.ok) return setMsg({ tone: 'error', text: res.error });
    setInput('');
    const now = await window.api.hasApiKey();
    setHasKey(now);
    setMsg({ tone: 'ok', text: now ? '已保存' : '已清除' });
  };

  const test = async () => {
    setBusy(true);
    setMsg({ tone: 'info', text: '验证中…' });
    const res = await window.api.testApiKey();
    setBusy(false);
    setMsg(
      res.ok
        ? { tone: 'ok', text: '连接正常,API Key 可用' }
        : { tone: 'error', text: res.error },
    );
  };

  return (
    <Card title={`${BAILIAN.label} API Key`}>
      <p className="mt-1 text-sm text-white/60">
        试卷照片会发送给{BAILIAN.shortName}识别。拍照时请避开孩子的姓名和学校。
      </p>
      <label className="mt-5 block text-sm text-white/80" htmlFor="api-key">
        API Key
        {hasKey && <span className="ml-2 text-mint">已设置</span>}
      </label>
      <div className="mt-2 flex gap-3">
        <input
          id="api-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={hasKey ? '已保存,如需更换请重新输入' : 'sk-...'}
          className={inputClass}
        />
        <button
          type="button"
          className={`${btn.secondary} shrink-0`}
          onClick={save}
          disabled={busy || (!input.trim() && !hasKey)}
        >
          {input.trim() || !hasKey ? '保存' : '清除'}
        </button>
        <button
          type="button"
          className={`${btn.secondary} shrink-0`}
          onClick={test}
          disabled={busy || !hasKey}
        >
          验证
        </button>
      </div>
      <p className="mt-2 text-xs text-white/50">
        {BAILIAN.keyHelp}
        Key
        只写入、不显示,保存在本机数据库里。数据库文件未加密,请不要把它发给别人。
      </p>
      {msg && (
        <div className="mt-3">
          <Note tone={msg.tone}>{msg.text}</Note>
        </div>
      )}
    </Card>
  );
}

function GradeCard() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    void window.api.getSettings().then((s) => {
      setSettings(s);
      setSaved(s);
    });
  }, []);

  if (!settings || !saved) return null;
  const changed =
    settings.grade !== saved.grade || settings.semester !== saved.semester;
  const promoted = settings.grade !== saved.grade;

  const save = async () => {
    setBusy(true);
    const res = await window.api.saveSettings(settings);
    setBusy(false);
    if (!res.ok) return setMsg({ tone: 'error', text: res.error });
    setSettings(res.value);
    setSaved(res.value);
    setMsg({ tone: 'ok', text: '已保存' });
  };

  return (
    <Card title="孩子的年级">
      <p className="mt-1 text-sm text-white/60">
        错题库和智能练习只使用当前年级、当前学期的错题。
      </p>
      <div className="mt-4 flex gap-3">
        <select
          aria-label="年级"
          value={settings.grade}
          onChange={(e) => {
            setSettings({ ...settings, grade: Number(e.target.value) });
            setMsg(null);
          }}
          className={`${inputClass} appearance-none`}
        >
          {GRADES.map((name, i) => (
            <option key={name} value={i + 1} className="text-ink">
              {name}年级(人教版)
            </option>
          ))}
        </select>
        <select
          aria-label="学期"
          value={settings.semester}
          onChange={(e) => {
            setSettings({
              ...settings,
              semester: Number(e.target.value) === 2 ? 2 : 1,
            });
            setMsg(null);
          }}
          className={`${inputClass} appearance-none`}
        >
          <option value={1} className="text-ink">
            上学期
          </option>
          <option value={2} className="text-ink">
            下学期
          </option>
        </select>
      </div>
      {changed && (
        <p className="mt-3 text-sm text-white/70">
          {promoted ? '升学后' : '换学期后'}
          ,之前的错题仍可在错题库里查看(选“全部学期”), 但不再用于出练习题。
        </p>
      )}
      <div className="mt-4 flex items-center gap-4">
        <button
          type="button"
          className={btn.secondary}
          onClick={save}
          disabled={busy || !changed}
        >
          保存
        </button>
        {msg && <Note tone={msg.tone}>{msg.text}</Note>}
      </div>
    </Card>
  );
}

function AboutCard() {
  const [version, setVersion] = useState('');
  const [state, setState] = useState<
    | { phase: 'idle' | 'checking' }
    | { phase: 'done'; result: UpdateCheckResult }
  >({ phase: 'idle' });

  useEffect(() => {
    void window.api.getAppVersion().then(setVersion);
  }, []);

  const check = async () => {
    setState({ phase: 'checking' });
    setState({ phase: 'done', result: await window.api.checkForUpdate() });
  };

  return (
    <Card title="关于">
      <p className="mt-2 text-white/75">当前版本 {version || '…'}</p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="button"
          className={btn.secondary}
          onClick={check}
          disabled={state.phase === 'checking'}
        >
          {state.phase === 'checking' ? '检查中…' : '检查更新'}
        </button>
        {state.phase === 'done' && (
          <>
            <Note
              tone={
                state.result.status === 'error'
                  ? 'error'
                  : state.result.status === 'update_available'
                    ? 'ok'
                    : 'info'
              }
            >
              {updateText(state.result)}
            </Note>
            {state.result.status === 'update_available' && (
              <button
                type="button"
                className={btn.primary}
                onClick={() => void window.api.openReleasePage()}
              >
                前往下载
              </button>
            )}
          </>
        )}
      </div>
      <p className="mt-3 text-xs text-white/50">
        只在点击时联网查询 GitHub,不会自动检查,也不会上传任何学习数据。
      </p>
    </Card>
  );
}

export function SettingsPage() {
  return (
    <Page title="设置">
      <div className="space-y-6 pb-4">
        <KeyCard />
        <GradeCard />
        <AboutCard />
      </div>
    </Page>
  );
}
