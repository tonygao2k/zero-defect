import { useState } from 'react';
import {
  BookIcon,
  CameraIcon,
  GearIcon,
  HomeIcon,
  StarIcon,
} from './components/Icons';
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

export function App() {
  const [page, setPage] = useState<PageId>('practice');

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
            active={page === 'settings'}
            label="设置"
            Icon={GearIcon}
            onClick={() => setPage('settings')}
          />
        </div>
      </aside>

      <main className="relative min-w-0 flex-1">
        <div className="absolute inset-x-0 top-0 h-10 [-webkit-app-region:drag]" />
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
