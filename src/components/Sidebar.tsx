import {
  AudioWaveform,
  Bot,
  Database,
  Disc3,
  FileText,
  FolderKanban,
  HardDrive,
  Heart,
  LayoutDashboard,
  LogOut,
  Mic,
  Settings,
  X,
} from 'lucide-react';
import { BackendMode, NavSection, User } from '../types/soundscribe';

interface SidebarProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
  user: User;
  backendMode: BackendMode;
  counts: {
    recordings: number;
    favorites: number;
    projects: number;
    lyrics: number;
  };
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onLogout: () => void;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'studio', label: 'Recording Studio', icon: Mic },
  { id: 'ideas', label: 'My Ideas', icon: Disc3 },
  { id: 'lyrics', label: 'Lyrics Workspace', icon: FileText },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'assistant', label: 'AI Music Assistant', icon: Bot },
  { id: 'favorites', label: 'Favorites', icon: Heart },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar({
  activeSection,
  onNavigate,
  user,
  backendMode,
  counts,
  mobileOpen,
  onCloseMobile,
  onLogout,
}: SidebarProps) {
  const getCountFor = (id: NavSection): number | null => {
    if (id === 'ideas') return counts.recordings;
    if (id === 'favorites') return counts.favorites;
    if (id === 'projects') return counts.projects;
    if (id === 'lyrics') return counts.lyrics;
    return null;
  };

  const navContent = (
    <div className="flex flex-col h-full bg-[#0F1117] border-r border-white/[0.08]">
      {/* Brand */}
      <div className="flex items-center justify-between px-5 h-16 border-b border-white/[0.06] shrink-0">
        <button
          type="button"
          onClick={() => {
            onNavigate('dashboard');
            onCloseMobile();
          }}
          className="flex items-center gap-2.5 text-left"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#8B5CF6] via-[#3B82F6] to-[#06B6D4] flex items-center justify-center shrink-0">
            <AudioWaveform className="w-4 h-4 text-white" />
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
            SoundScribe
          </span>
        </button>

        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06]"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          const count = getCountFor(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onNavigate(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-[#8B5CF6]/15 text-white border border-[#8B5CF6]/30'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04] border border-transparent'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    active ? 'text-[#A78BFA]' : 'text-slate-500'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </span>
              {count !== null && count > 0 && (
                <span className="font-mono-tabular text-xs text-slate-400 shrink-0">{count}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Storage Mode & Account Footer */}
      <div className="p-3 border-t border-white/[0.06] space-y-2.5 shrink-0">
        <button
          type="button"
          onClick={() => {
            onNavigate('settings');
            onCloseMobile();
          }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] text-left transition-colors"
        >
          {backendMode === 'supabase' ? (
            <Database className="w-3.5 h-3.5 text-[#06B6D4] shrink-0" />
          ) : (
            <HardDrive className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-200 truncate">
              {user.id.startsWith('guest_')
                ? 'Guest Mode (Unsigned)'
                : backendMode === 'supabase'
                  ? 'Supabase Cloud'
                  : 'Local Dev Mode'}
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {user.id.startsWith('guest_')
                ? 'IndexedDB local storage'
                : backendMode === 'supabase'
                  ? 'RLS & private bucket active'
                  : 'IndexedDB browser storage'}
            </div>
          </div>
        </button>

        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-white truncate">{user.display_name}</span>
              {user.id.startsWith('guest_') && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/30">
                  Guest
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {user.id.startsWith('guest_') ? 'Unsigned session' : user.email}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            title={user.id.startsWith('guest_') ? 'Exit Guest Mode' : 'Sign out'}
            aria-label={user.id.startsWith('guest_') ? 'Exit Guest Mode' : 'Sign out'}
            className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop persistent sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 h-screen sticky top-0">
        {navContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] h-full">{navContent}</aside>
        </div>
      )}
    </>
  );
}
