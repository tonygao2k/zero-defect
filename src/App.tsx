import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { APP_DISPLAY_NAME } from './shared/app-info';
import {
  BookIcon,
  CameraIcon,
  GearIcon,
  HomeIcon,
  ShieldIcon,
  SparkIcon,
  StarIcon,
} from './components/Icons';
import { Hero } from './components/Hero';
import { ParentPage } from './pages/ParentPage';
import { UploadPage } from './pages/UploadPage';

type PageId = 'home' | 'upload' | 'practice' | 'mistakes' | 'parent';

const NAV: { id: PageId; label: string; Icon: typeof HomeIcon }[] = [
  { id: 'home', label: '首页', Icon: HomeIcon },
  { id: 'upload', label: '上传错题', Icon: CameraIcon },
  { id: 'practice', label: '每日练习', Icon: StarIcon },
  { id: 'mistakes', label: '错题本', Icon: BookIcon },
];

// 占位内容,等 IPC 接通后换成 getHomeSummary() 的真实数据。
const FEATURES = [
  { Icon: CameraIcon, text: '拍照上传错题' },
  { Icon: SparkIcon, text: 'AI 找出出错原因' },
  { Icon: ShieldIcon, text: '针对性练习,直到掌握' },
];

const formulaSample = '例:$24 - 24 \\times \\frac{1}{3} = 16$';

function NavButton(props: {
  active: boolean;
  label: string;
  Icon: typeof HomeIcon;
  onClick: () => void;
}) {
  const { active, label, Icon, onClick } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex h-14 w-full items-center gap-3 rounded-2xl px-4 text-left text-[15px] font-medium transition-colors ${
        active
          ? 'bg-white/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'
          : 'text-white/75 hover:bg-white/10 hover:text-white'
      }`}
    >
      <Icon className="h-6 w-6 shrink-0" />
      {label}
    </button>
  );
}

function HomePage({ onNavigate }: { onNavigate: (p: PageId) => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 items-center justify-center gap-10 px-10">
        <Hero />
        <div className="max-w-sm">
          <h1 className="text-5xl font-semibold tracking-wide">
            {APP_DISPLAY_NAME}
          </h1>
          <p className="mt-3 text-base text-white/75">
            把不会的题交给我,一天几道,慢慢全会。
          </p>
          <ul className="mt-8 space-y-4">
            {FEATURES.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-4">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-base font-semibold">{text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 rounded-2xl bg-black/15 px-4 py-3 text-sm text-white/80">
            <Markdown
              remarkPlugins={[remarkMath]}
              rehypePlugins={[rehypeKatex]}
            >
              {formulaSample}
            </Markdown>
          </div>
        </div>
      </div>

      <div className="flex items-end justify-center gap-6 pb-8">
        <button
          type="button"
          onClick={() => onNavigate('upload')}
          className="h-14 rounded-full bg-white/15 px-8 text-base font-semibold text-white ring-1 ring-white/30 transition hover:bg-white/25"
        >
          上传错题
        </button>
        <button
          type="button"
          onClick={() => onNavigate('practice')}
          className="start-btn grid h-28 w-28 place-items-center rounded-full bg-gradient-to-b from-[#b6ffd8] to-[#22c97a] text-xl font-bold text-ink ring-4 ring-white/70 transition active:scale-95"
        >
          开始
        </button>
        <div className="w-[122px]" aria-hidden="true" />
      </div>
    </div>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="text-center">
        <h1 className="text-4xl font-semibold">{title}</h1>
        <p className="mt-3 text-white/70">功能开发中</p>
      </div>
    </div>
  );
}

const TITLES: Record<PageId, string> = {
  home: '首页',
  upload: '上传错题',
  practice: '每日练习',
  mistakes: '错题本',
  parent: '家长入口',
};

export function App() {
  const [page, setPage] = useState<PageId>('home');

  return (
    <div className="app-bg flex h-full text-white">
      <aside className="flex w-64 shrink-0 flex-col border-r border-white/10 px-4 pb-5 pt-16 [-webkit-app-region:drag]">
        <nav className="space-y-2 [-webkit-app-region:no-drag]">
          {NAV.map((item) => (
            <NavButton
              key={item.id}
              active={page === item.id}
              label={item.label}
              Icon={item.Icon}
              onClick={() => setPage(item.id)}
            />
          ))}
        </nav>

        <div className="mt-auto space-y-1 [-webkit-app-region:no-drag]">
          <NavButton
            active={page === 'parent'}
            label="家长入口"
            Icon={GearIcon}
            onClick={() => setPage('parent')}
          />
        </div>
      </aside>

      <main className="relative min-w-0 flex-1">
        <div className="absolute inset-x-0 top-0 h-10 [-webkit-app-region:drag]" />
        {page === 'home' ? (
          <HomePage onNavigate={setPage} />
        ) : page === 'parent' ? (
          <ParentPage />
        ) : page === 'upload' ? (
          <UploadPage />
        ) : (
          <PlaceholderPage title={TITLES[page]} />
        )}
      </main>
    </div>
  );
}
