import { useEffect, useState } from 'react';
import { ChevronDownIcon } from '../components/Icons';
import { Note, Page, btn, inputClass } from '../components/ui';
import { BAILIAN } from '../shared/bailian';
import type { AiConfig, UpdateCheckResult } from '../shared/ipc';
import {
  DEFAULT_PRACTICE_QUESTION_COUNT,
  MAX_PRACTICE_QUESTION_COUNT,
  type Settings,
} from '../shared/settings';

const GRADES = ['一', '二', '三', '四', '五', '六'];
const PRACTICE_DIFFICULTIES = [
  { value: 'easy', label: '容易' },
  { value: 'medium', label: '适中' },
  { value: 'hard', label: '困难' },
] as const;

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
    <section className="@container min-w-0 rounded-3xl bg-white/5 p-6 ring-1 ring-inset ring-white/10">
      <h2 className="font-semibold">{props.title}</h2>
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
      <div className="mt-2 space-y-3">
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
        <div className="flex flex-wrap gap-3">
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
    const res = await window.api.saveSettings({
      grade: settings.grade,
      semester: settings.semester,
    });
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
      <div className="mt-5 grid gap-4 @min-[360px]:grid-cols-2">
        <label className="block min-w-0">
          <span className="mb-2 block text-sm text-white/75">年级</span>
          <div className="relative">
            <select
              aria-label="年级"
              value={settings.grade}
              onChange={(e) => {
                setSettings({ ...settings, grade: Number(e.target.value) });
                setMsg(null);
              }}
              className={`${inputClass} appearance-none pr-11`}
            >
              {GRADES.map((name, i) => (
                <option key={name} value={i + 1} className="text-ink">
                  {name}年级(人教版)
                </option>
              ))}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
          </div>
        </label>
        <label className="block min-w-0">
          <span className="mb-2 block text-sm text-white/75">学期</span>
          <div className="relative">
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
              className={`${inputClass} appearance-none pr-11`}
            >
              <option value={1} className="text-ink">
                上学期
              </option>
              <option value={2} className="text-ink">
                下学期
              </option>
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
          </div>
        </label>
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
    <Card title="关于应用">
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
        启动后会在后台检查更新,运行期间每 6 小时再检查,也可手动检查。
        检查会联网查询 GitHub,不会上传任何学习数据。
      </p>
    </Card>
  );
}

function ModelCard() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    void window.api.getAiConfig().then(setConfig);
    void window.api.getSettings().then((s) => {
      setSettings(s);
      setSaved(s);
    });
  }, []);

  const changed =
    settings !== null &&
    saved !== null &&
    (settings.practiceDifficulty !== saved.practiceDifficulty ||
      settings.practiceQuestionCount !== saved.practiceQuestionCount);

  const savePracticeSettings = async () => {
    if (!settings) return;
    setBusy(true);
    const res = await window.api.saveSettings({
      practiceDifficulty: settings.practiceDifficulty,
      practiceQuestionCount: settings.practiceQuestionCount,
    });
    setBusy(false);
    if (!res.ok) return setMsg({ tone: 'error', text: res.error });
    setSettings(res.value);
    setSaved(res.value);
    setMsg({ tone: 'ok', text: '已保存' });
  };

  return (
    <Card title="AI">
      <p className="mt-1 text-sm text-white/60">
        当前识别和练习使用的模型由应用配置统一管理。
      </p>
      {config ? (
        <dl className="mt-5 grid gap-3 text-sm @min-[520px]:grid-cols-2">
          <div className="rounded-2xl bg-black/15 px-4 py-3 ring-1 ring-inset ring-white/10">
            <dt className="text-xs text-white/50">试卷识别与归因</dt>
            <dd className="mt-1 break-all font-medium text-mint">
              {config.recognitionModel}
            </dd>
          </div>
          <div className="rounded-2xl bg-black/15 px-4 py-3 ring-1 ring-inset ring-white/10">
            <dt className="text-xs text-white/50">智能练习生成</dt>
            <dd className="mt-1 break-all font-medium text-mint">
              {config.practiceModel}
            </dd>
          </div>
          <div className="rounded-2xl bg-black/15 px-4 py-3 ring-1 ring-inset ring-white/10 @min-[520px]:col-span-2">
            <dt className="text-xs text-white/50">练习答案校验</dt>
            <dd className="mt-1 break-all font-medium text-mint">
              {config.verificationModel}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-5 text-sm text-white/50">正在读取模型配置…</p>
      )}
      {config && (
        <p className="mt-4 text-xs text-white/45">
          服务商：{config.provider} · {config.displayName}
        </p>
      )}
      <div className="mt-6 border-t border-white/10 pt-5">
        <div className="grid gap-4 @min-[360px]:grid-cols-2">
          <label className="block min-w-0">
            <span className="mb-2 block text-sm text-white/75">出题难度</span>
            <div className="relative">
              <select
                aria-label="出题难度"
                value={settings?.practiceDifficulty ?? 'medium'}
                onChange={(e) => {
                  const value = e.target.value;
                  if (
                    value !== 'easy' &&
                    value !== 'medium' &&
                    value !== 'hard'
                  )
                    return;
                  if (settings) {
                    setSettings({ ...settings, practiceDifficulty: value });
                    setMsg(null);
                  }
                }}
                disabled={!settings || busy}
                className={`${inputClass} appearance-none pr-11`}
              >
                {PRACTICE_DIFFICULTIES.map((item) => (
                  <option
                    key={item.value}
                    value={item.value}
                    className="text-ink"
                  >
                    {item.label}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
            </div>
            <span className="mt-2 block text-xs text-white/50">
              用于下一次智能练习出题，默认建议使用“适中”。
            </span>
          </label>
          <label className="block min-w-0">
            <span className="mb-2 block text-sm text-white/75">
              每次练习的题目数量
            </span>
            <div className="relative">
              <select
                aria-label="每次练习的题目数量"
                value={
                  settings?.practiceQuestionCount ??
                  DEFAULT_PRACTICE_QUESTION_COUNT
                }
                onChange={(event) => {
                  if (!settings) return;
                  setSettings({
                    ...settings,
                    practiceQuestionCount: Number(event.target.value),
                  });
                  setMsg(null);
                }}
                disabled={!settings || busy}
                className={`${inputClass} appearance-none pr-11`}
              >
                {Array.from(
                  { length: MAX_PRACTICE_QUESTION_COUNT },
                  (_, index) => index + 1,
                ).map((count) => (
                  <option key={count} value={count} className="text-ink">
                    {count} 道
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
            </div>
            <span className="mt-2 block text-xs text-white/50">
              默认 5 道，新一轮练习生效；题目不足时可能少于设定数量。
            </span>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <button
            type="button"
            className={btn.secondary}
            onClick={() => void savePracticeSettings()}
            disabled={busy || !changed}
          >
            保存
          </button>
          {msg && <Note tone={msg.tone}>{msg.text}</Note>}
        </div>
      </div>
    </Card>
  );
}

export function SettingsPage() {
  return (
    <Page title="设置" description="管理孩子的学习阶段、识别服务和应用版本。">
      <div className="grid max-w-6xl items-start gap-5 min-[1280px]:grid-cols-2">
        <GradeCard />
        <KeyCard />
        <ModelCard />
        <AboutCard />
      </div>
    </Page>
  );
}
