import { FormEvent, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Database,
  HardDrive,
  LogOut,
  Save,
  Sliders,
  Sparkles,
  User as UserIcon,
} from 'lucide-react';
import { AIPreferences, AudioPreferences, BackendMode, User } from '../types/soundscribe';
import { AudioDeviceOption, listAudioInputDevices } from '../services/audioEngine';
import { checkServerHealth, ServerHealthResponse } from '../services/aiClient';

interface SettingsViewProps {
  user: User;
  backendMode: BackendMode;
  onUpdateProfile: (patch: Partial<User>) => Promise<User>;
  onLogout: () => Promise<void>;
}

const SQL_MIGRATION_SNIPPET = `-- Run supabase/migrations/001_soundscribe_schema.sql in your Supabase SQL Editor.
-- Creates profiles, projects, recordings, analyses, lyrics, compositions, favorites,
-- Row Level Security policies, and private 'recordings' storage bucket.`;

export function SettingsView({
  user,
  backendMode,
  onUpdateProfile,
  onLogout,
}: SettingsViewProps) {
  const [displayName, setDisplayName] = useState(user.display_name);
  const [audioPrefs, setAudioPrefs] = useState<AudioPreferences>(user.audio_preferences);
  const [aiPrefs, setAiPrefs] = useState<AIPreferences>(user.ai_preferences);
  const [devices, setDevices] = useState<AudioDeviceOption[]>([]);
  const [serverHealth, setServerHealth] = useState<ServerHealthResponse | null>(null);

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  useEffect(() => {
    listAudioInputDevices().then(setDevices);
    checkServerHealth()
      .then((h) => setServerHealth(h))
      .catch(() => setServerHealth(null));
  }, []);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      await onUpdateProfile({
        display_name: displayName.trim() || user.display_name,
        audio_preferences: audioPrefs,
        ai_preferences: aiPrefs,
      });
      setNotice('Studio settings saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-slate-400">
          Manage your musician profile, backend storage connection, microphone defaults, and AI
          preferences.
        </p>
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-xs text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Profile Section */}
        <section className="rounded-xl bg-[#12141C] border border-white/[0.08] p-6 space-y-4">
          <div className="flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-[#A78BFA]" />
            <h2 className="font-display text-base font-semibold text-white">Profile & Account</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="settings-name" className="text-xs font-medium text-slate-300">
                Display Name
              </label>
              <input
                id="settings-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Account Email</label>
              <input
                type="email"
                disabled
                value={user.email}
                className="w-full px-3.5 py-2 rounded-lg bg-[#090A0E]/60 border border-white/[0.06] text-sm text-slate-400 cursor-not-allowed"
              />
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between border-t border-white/[0.06]">
            <span className="font-mono-tabular text-xs text-slate-500">Account ID: {user.id}</span>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-xs font-medium text-rose-300 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </section>

        {/* Backend & Supabase Connection */}
        <section className="rounded-xl bg-[#12141C] border border-white/[0.08] p-6 space-y-4">
          <div className="flex items-center gap-2">
            {backendMode === 'supabase' ? (
              <Database className="w-4 h-4 text-[#06B6D4]" />
            ) : (
              <HardDrive className="w-4 h-4 text-amber-400" />
            )}
            <h2 className="font-display text-base font-semibold text-white">
              Database & Private Audio Storage
            </h2>
          </div>

          {backendMode === 'supabase' ? (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-4 text-xs text-emerald-200 space-y-1">
              <p className="font-semibold">Connected to Supabase Cloud</p>
              <p>
                Authentication, PostgreSQL Row Level Security, and private bucket signed audio URLs
                are active.
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-4 space-y-2.5">
              <p className="text-xs font-semibold text-amber-200">
                Supabase credentials not configured — Running in Local Development Mode
              </p>
              <p className="text-xs text-amber-100/80 leading-relaxed">
                Recordings, audio blobs, projects, lyrics, analyses, and compositions are stored
                locally in your browser’s IndexedDB so nothing is lost on refresh. To enable cloud
                persistence across devices, set <code className="font-mono">VITE_SUPABASE_URL</code>{' '}
                and <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> in your environment
                and run <code className="font-mono">supabase/migrations/001_soundscribe_schema.sql</code>{' '}
                in your Supabase SQL Editor.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(SQL_MIGRATION_SNIPPET);
                    setCopiedSql(true);
                    window.setTimeout(() => setCopiedSql(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-xs text-white"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedSql ? 'Copied migration note' : 'Copy migration path'}</span>
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Audio Preferences */}
        <section className="rounded-xl bg-[#12141C] border border-white/[0.08] p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#06B6D4]" />
            <h2 className="font-display text-base font-semibold text-white">Audio Preferences</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Preferred Microphone</label>
              <select
                value={audioPrefs.preferredInputId || ''}
                onChange={(e) =>
                  setAudioPrefs({ ...audioPrefs, preferredInputId: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-white"
              >
                <option value="">System Default Input</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Waveform Detail</label>
              <select
                value={audioPrefs.waveformDensity}
                onChange={(e) =>
                  setAudioPrefs({
                    ...audioPrefs,
                    waveformDensity: e.target.value as AudioPreferences['waveformDensity'],
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-white"
              >
                <option value="compact">Compact</option>
                <option value="standard">Standard</option>
                <option value="detailed">Detailed</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={audioPrefs.autoSaveDrafts}
              onChange={(e) =>
                setAudioPrefs({ ...audioPrefs, autoSaveDrafts: e.target.checked })
              }
              className="rounded border-white/20 bg-[#090A0E] text-[#8B5CF6]"
            />
            <span>Prompt confirmation before clearing unsaved takes in Recording Studio</span>
          </label>
        </section>

        {/* AI Settings */}
        <section className="rounded-xl bg-[#12141C] border border-white/[0.08] p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#A78BFA]" />
            <h2 className="font-display text-base font-semibold text-white">AI Collaboration</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Creative Focus</label>
              <select
                value={aiPrefs.creativeFocus}
                onChange={(e) =>
                  setAiPrefs({
                    ...aiPrefs,
                    creativeFocus: e.target.value as AIPreferences['creativeFocus'],
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-white"
              >
                <option value="songwriting">Songwriting & Melody</option>
                <option value="arrangement">Arrangement & Dynamics</option>
                <option value="production">Production & Instrumentation</option>
                <option value="lyricism">Lyricism & Storytelling</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Suggestion Style</label>
              <select
                value={aiPrefs.conservatism}
                onChange={(e) =>
                  setAiPrefs({
                    ...aiPrefs,
                    conservatism: e.target.value as AIPreferences['conservatism'],
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-white"
              >
                <option value="conservative">Conservative (stay close to original sketch)</option>
                <option value="balanced">Balanced</option>
                <option value="exploratory">Exploratory (bold harmonic/structural ideas)</option>
              </select>
            </div>
          </div>

          {/* Groq Audio Analysis Engine Status Card */}
          <div className="rounded-lg bg-[#090A0E] border border-white/[0.08] p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    serverHealth?.groqConfigured ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                Groq Audio Analysis Engine ({serverHealth?.groqModel || 'whisper-large-v3'})
              </span>
              <span
                className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                  serverHealth?.groqConfigured
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                }`}
              >
                {serverHealth?.groqConfigured ? 'Active & Usable' : 'Key Not Configured'}
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              {serverHealth?.groqModelStatus?.details ||
                'Free tier model whisper-large-v3 provides high-speed, verbatim vocal transcription and audio understanding without deprecation (20 RPM, 2000 RPD, 7,200s audio/hr).'}
            </p>

            {!serverHealth?.groqConfigured && (
              <p className="text-xs text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded p-2.5">
                To activate, add your Groq API key to your <code className="font-mono text-white">.env</code> file:{' '}
                <code className="font-mono text-white">GROQ_API_KEY="gsk_..."</code>
              </p>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
            <span>
              Gemini AI Engine:{' '}
              {serverHealth?.geminiConfigured ? (
                <span className="text-emerald-400 font-medium">Configured</span>
              ) : (
                <span className="text-slate-500">Not configured</span>
              )}
            </span>
            <span className="text-slate-500">
              Provider Mode:{' '}
              {serverHealth?.groqConfigured && serverHealth?.geminiConfigured
                ? 'Hybrid (Whisper + Gemini)'
                : serverHealth?.groqConfigured
                  ? 'Groq Whisper'
                  : serverHealth?.geminiConfigured
                    ? 'Gemini'
                    : 'Local Only'}
            </span>
          </div>
        </section>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] hover:opacity-95 disabled:opacity-50 text-white text-sm font-semibold transition-opacity"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving...' : 'Save Settings'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
