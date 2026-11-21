import { useState } from 'react';
import logoPic from './assets/brand/logo_pic.png';
import logoText from './assets/brand/logo_text.png';
import {
  BookIcon,
  CameraIcon,
  ChartIcon,
  GearIcon,
  HomeIcon,
  StarIcon,
} from './components/Icons';
import { APP_DISPLAY_NAME } from './shared/app-info';
import { LibraryPage } from './pages/LibraryPage';
import { PracticePage } from './pages/PracticePage';
import { SettingsPage } from './pages/SettingsPage';
import { UploadPage } from './pages/UploadPage';
import { WeeklyReportPage } from './pages/WeeklyReportPage';
import { UpdateNotice } from './components/UpdateNotice';

type PageId = 'practice' | 'upload' | 'library' | 'weeklyReport' | 'settings';

const NAV: { id: PageId; label: string; Icon: typeof HomeIcon }[] = [
  { id: 'practice', label: '智能练习', Icon: StarIcon },
  { id: 'upload', label: '上传错题', Icon: CameraIcon },
  { id: 'library', label: '错题库', Icon: BookIcon },
  { id: 'weeklyReport', label: '学习周报', Icon: ChartIcon },
];

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
      className={`relative flex h-14 w-full items-center gap-3 rounded-2xl px-4 text-left text-[15px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-[#14734f] ${
        active
          ? 'bg-[#d9fbe8] text-[#163d2b] shadow-[0_4px_16px_rgba(0,0,0,0.12)]'
          : 'text-white/80 hover:bg-white/7 hover:text-white'
      }`}
    >
      <Icon className="h-5 w-5 shrink-0" />
      {label}
    </button>
  );
}

export function App() {
  const [page, setPage] = useState<PageId>('practice');

  return (
    <div className="app-bg flex h-full min-h-0 overflow-hidden text-white">
      <aside
        data-tauri-drag-region="deep"
        aria-label="应用导航"
        className="relative z-10 flex w-64 shrink-0 flex-col border-r border-white/10 bg-black/15 px-4 pb-5 pt-16 shadow-[4px_0_20px_rgba(0,0,0,0.04)] "
      >
        <div
          aria-label={APP_DISPLAY_NAME}
          className="brand-panel relative mb-8 overflow-hidden rounded-[26px] p-3"
        >
          <span
            aria-hidden="true"
            className="brand-panel-glow pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-mint/25 blur-3xl"
          />
          <div className="relative flex items-center gap-3">
            <span className="brand-mark grid h-15 w-15 shrink-0 place-items-center rounded-[21px] shadow-[0_8px_24px_rgba(2,45,31,0.34)]">
              <img
                src={logoPic}
                alt=""
                draggable={false}
                className="h-13 w-11 object-contain"
              />
            </span>
            <span className="min-w-0 flex-1">
              <img
                src={logoText}
                alt={APP_DISPLAY_NAME}
                draggable={false}
                className="brand-wordmark block h-auto w-20 max-w-full"
              />
              <span className="mt-1.5 inline-flex rounded-full bg-mint/10 px-2 py-0.5 text-[12px] font-medium tracking-[0.12em] text-mint/85">
                AI 学习助手
              </span>
            </span>
          </div>
        </div>
        <nav aria-label="主导航" className="space-y-2 ">
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

        <div className="mt-auto border-t border-white/10 pt-4 ">
          <NavButton
            active={page === 'settings'}
            label="设置"
            Icon={GearIcon}
            onClick={() => setPage('settings')}
          />
        </div>
      </aside>

      <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-10" />
        <div className="h-full" hidden={page !== 'practice'}>
          <PracticePage active={page === 'practice'} />
        </div>
        {/* 上传页常驻挂载只做隐藏:切换页签时已添加的图片不会丢。 */}
        <div className="h-full" hidden={page !== 'upload'}>
          <UploadPage onOpenLibrary={() => setPage('library')} />
        </div>
        {page === 'library' && <LibraryPage />}
        {page === 'weeklyReport' && (
          <WeeklyReportPage onPractice={() => setPage('practice')} />
        )}
        {page === 'settings' && <SettingsPage />}
      </main>
      <UpdateNotice />
    </div>
  );
}
