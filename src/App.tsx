import { useState } from 'react';
import logoPic from './assets/brand/logo_pic.png';
import logoText from './assets/brand/logo_text.png';
import {
  BookIcon,
  CameraIcon,
  GearIcon,
  HomeIcon,
  StarIcon,
} from './components/Icons';
import { APP_DISPLAY_NAME } from './shared/app-info';
import { LibraryPage } from './pages/LibraryPage';
import { PracticePage } from './pages/PracticePage';
import { SettingsPage } from './pages/SettingsPage';
import { UploadPage } from './pages/UploadPage';

type PageId = 'practice' | 'upload' | 'library' | 'settings';

const NAV: { id: PageId; label: string; Icon: typeof HomeIcon }[] = [
  { id: 'practice', label: '智能练习', Icon: StarIcon },
  { id: 'upload', label: '上传错题', Icon: CameraIcon },
  { id: 'library', label: '错题库', Icon: BookIcon },
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
        <div aria-label={APP_DISPLAY_NAME} className="relative mb-10 px-3 py-2">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-mint/20 blur-2xl"
          />
          <div className="relative flex items-center gap-3">
            <span className="brand-mark grid h-14 w-14 shrink-0 place-items-center rounded-[19px] shadow-[0_8px_24px_rgba(2,45,31,0.3)]">
              <img
                src={logoPic}
                alt=""
                draggable={false}
                className="h-12 w-10 object-contain"
              />
            </span>
            <span className="min-w-0 flex-1">
              <img
                src={logoText}
                alt={APP_DISPLAY_NAME}
                draggable={false}
                className="brand-wordmark block h-auto w-24 max-w-full"
              />
              <span className="mt-1 block whitespace-nowrap text-[14px] tracking-[0.16em] text-mint/80">
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
        {page === 'practice' && <PracticePage />}
        {/* 上传页常驻挂载只做隐藏:切换页签时已添加的图片不会丢。 */}
        <div className="h-full" hidden={page !== 'upload'}>
          <UploadPage onOpenLibrary={() => setPage('library')} />
        </div>
        {page === 'library' && <LibraryPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
