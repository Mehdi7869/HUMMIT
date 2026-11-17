import { FormEvent, useState } from 'react';
import { AudioWaveform, Database, HardDrive, Loader2, Lock, Mail, Sparkles, User as UserIcon } from 'lucide-react';
import { BackendMode, User } from '../types/hummit';
import { dataService } from '../services/dataService';

interface AuthGateProps {
  backendMode: BackendMode;
  onAuthenticated: (user: User) => void;
}

export function AuthGate({ backendMode, onAuthenticated }: AuthGateProps) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGuestLogin = async () => {
    setGuestLoading(true);
    setError(null);
    try {
      const guest = await dataService.continueAsGuest();
      onAuthenticated(guest);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch guest mode.');
    } finally {
      setGuestLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const user =
        mode === 'register'
          ? await dataService.register(email, password, displayName)
          : await dataService.login(email, password);
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0C10] text-[#F2F4F8] flex flex-col lg:flex-row">
      {/* Left Studio Visual Showcase */}
      <div className="relative lg:w-1/2 min-h-[240px] lg:min-h-screen overflow-hidden border-b lg:border-b-0 lg:border-r border-white/[0.08] flex flex-col justify-between p-8 lg:p-14">
        <img
          src="/src/assets/images/studio_hero_backdrop_1794847607064.jpg"
          alt="HUMMIT recording studio console"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover opacity-50"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C10] via-[#0B0C10]/70 to-[#0B0C10]/40" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#8B5CF6] via-[#3B82F6] to-[#06B6D4] flex items-center justify-center shadow-lg">
            <AudioWaveform className="w-5 h-5 text-white" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight text-white">
            HUMMIT
          </span>
        </div>

        <div className="relative z-10 max-w-lg space-y-4 my-8 lg:my-0">
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight">
            Never Lose a Musical Idea.
          </h1>
          <p className="text-slate-300 text-base leading-relaxed">
            Capture voice memos and instrument sketches directly from your microphone, inspect
            waveforms, organize sessions by project, and turn raw recordings into full arrangements
            with Gemini AI.
          </p>
        </div>

        <div className="relative z-10 flex items-center gap-3 text-xs text-slate-300">
          {backendMode === 'supabase' ? (
            <>
              <Database className="w-4 h-4 text-[#06B6D4] shrink-0" />
              <span>Connected to Supabase Cloud Auth, PostgreSQL & Private Audio Storage</span>
            </>
          ) : (
            <>
              <HardDrive className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Local Development Mode active (IndexedDB). Add Supabase keys in environment
                variables to enable cloud sync.
              </span>
            </>
          )}
        </div>
      </div>

      {/* Right Authentication Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-1.5">
            <h2 className="font-display text-2xl font-bold text-white">
              {mode === 'register' ? 'Create your studio account' : 'Sign in to your studio'}
            </h2>
            <p className="text-sm text-slate-400">
              {backendMode === 'supabase'
                ? 'Your recordings, lyrics, and compositions stay isolated to your account.'
                : 'Accounts and recordings are stored privately per user in your browser IndexedDB.'}
            </p>
          </div>

          <div className="flex p-1 rounded-lg bg-[#141720] border border-white/[0.08]">
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'register'
                  ? 'bg-[#8B5CF6] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Create Account
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'login' ? 'bg-[#8B5CF6] text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-sm text-rose-300"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <label htmlFor="auth-name" className="block text-xs font-medium text-slate-300">
                  Artist or Producer Name
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Maya Lin"
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[#141720] border border-white/[0.1] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#8B5CF6]"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="auth-email" className="block text-xs font-medium text-slate-300">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="artist@studio.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[#141720] border border-white/[0.1] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#8B5CF6]"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="auth-password" className="block text-xs font-medium text-slate-300">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[#141720] border border-white/[0.1] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#8B5CF6]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || guestLoading}
              className="w-full py-2.5 px-4 rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] hover:opacity-95 disabled:opacity-50 text-white text-sm font-semibold transition-opacity flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{mode === 'register' ? 'Create Studio Account' : 'Sign In'}</span>
            </button>
          </form>

          {/* Guest Mode Option */}
          <div className="pt-2 space-y-3">
            <div className="relative flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/[0.08]" />
              </div>
              <div className="relative px-3 bg-[#0B0C10] text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                Or test unsigned
              </div>
            </div>

            <button
              type="button"
              onClick={handleGuestLogin}
              disabled={loading || guestLoading}
              className="w-full py-2.5 px-4 rounded-lg bg-[#141720] hover:bg-[#1C202C] border border-white/[0.12] hover:border-[#8B5CF6]/50 text-white text-sm font-medium transition-all flex items-center justify-center gap-2.5 group shadow-sm"
            >
              {guestLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#8B5CF6]" />
              ) : (
                <Sparkles className="w-4 h-4 text-[#8B5CF6] group-hover:scale-110 transition-transform" />
              )}
              <span>Continue as Guest (No Sign-In Required)</span>
            </button>

            <p className="text-[11px] text-center text-slate-400 leading-relaxed">
              Explore the Recording Studio, Groq Whisper Audio Analysis, and AI Assistant immediately.
              Data is saved locally in this browser.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
