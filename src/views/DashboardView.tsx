import { ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Disc3,
  FileText,
  FolderKanban,
  Loader2,
  Mic,
  Pause,
  Play,
  Plus,
  Square,
  Upload,
} from 'lucide-react';
import {
  ActivityItem,
  Analysis,
  Composition,
  Lyrics,
  NavSection,
  Project,
  Recording,
  User,
} from '../types/hummit';
import {
  CapturedAudio,
  mapMicError,
  MicrophoneRecorder,
  MicStatus,
  validateAudioFile,
  extractAudioDuration,
} from '../services/audioEngine';
import { LiveWaveformCanvas } from '../components/LiveWaveformCanvas';
import { WaveformPlayer } from '../components/WaveformPlayer';
import { deriveCreativeActivity, formatDuration, formatRelativeDate } from '../utils/formatters';

interface DashboardViewProps {
  user: User;
  recordings: Recording[];
  projects: Project[];
  analyses: Analysis[];
  lyrics: Lyrics[];
  compositions: Composition[];
  onNavigate: (section: NavSection) => void;
  onOpenRecording: (recordingId: string) => void;
  onOpenProject: (projectId: string) => void;
  onSaveQuickRecording: (params: {
    title: string;
    description: string;
    tags: string[];
    projectId: string | null;
    blob: Blob;
    duration: number;
    mimeType: string;
  }) => Promise<Recording>;
  onUploadFileToStudio: (file: File) => void;
}

export function DashboardView({
  user,
  recordings,
  projects,
  analyses,
  lyrics,
  compositions,
  onNavigate,
  onOpenRecording,
  onOpenProject,
  onSaveQuickRecording,
  onUploadFileToStudio,
}: DashboardViewProps) {
  const recorderRef = useRef<MicrophoneRecorder | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const timerIntervalRef = useRef<number | null>(null);

  const [micStatus, setMicStatus] = useState<MicStatus>('idle');
  const [micError, setMicError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [quickCapture, setQuickCapture] = useState<CapturedAudio | null>(null);
  const [quickTitle, setQuickTitle] = useState('');
  const [savingQuick, setSavingQuick] = useState(false);

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) window.clearInterval(timerIntervalRef.current);
      recorderRef.current?.discard();
      if (quickCapture?.url) URL.revokeObjectURL(quickCapture.url);
    };
  }, []);

  const activeDrafts = recordings.filter((r) => r.status === 'draft');
  const activeProjects = projects.filter((p) => p.status === 'active');
  const recentRecordings = recordings.slice(0, 4);
  const recentProjects = projects.slice(0, 4);
  const activity: ActivityItem[] = deriveCreativeActivity({
    recordings,
    projects,
    analyses,
    lyrics,
    compositions,
  });

  const startQuickRecord = async () => {
    if (micStatus === 'recording' || micStatus === 'paused') return;
    setMicError(null);
    if (quickCapture?.url) {
      URL.revokeObjectURL(quickCapture.url);
      setQuickCapture(null);
    }

    const recorder = new MicrophoneRecorder();
    recorderRef.current = recorder;
    setMicStatus('requesting');

    try {
      await recorder.requestAndStart(user.audio_preferences?.preferredInputId);
      setMicStatus('recording');
      setElapsed(0);
      timerIntervalRef.current = window.setInterval(() => {
        setElapsed(recorder.getElapsedSeconds());
      }, 100);
    } catch (err) {
      const mapped = mapMicError(err);
      setMicStatus(mapped.status);
      setMicError(mapped.message);
      recorder.discard();
    }
  };

  const pauseOrResumeQuick = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (micStatus === 'recording') {
      rec.pause();
      setMicStatus('paused');
    } else if (micStatus === 'paused') {
      rec.resume();
      setMicStatus('recording');
    }
  };

  const stopQuickRecord = async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (timerIntervalRef.current) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    try {
      const captured = await rec.stop();
      setQuickCapture(captured);
      setQuickTitle(`Quick Sketch ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
      setMicStatus('ready');
    } catch (err) {
      setMicError(err instanceof Error ? err.message : 'Unable to finalize recording.');
      setMicStatus('error');
    }
  };

  const saveQuickCapture = async () => {
    if (!quickCapture) return;
    setSavingQuick(true);
    try {
      const saved = await onSaveQuickRecording({
        title: quickTitle.trim() || 'Quick Studio Sketch',
        description: 'Captured from Dashboard quick recorder',
        tags: ['quick-sketch'],
        projectId: null,
        blob: quickCapture.blob,
        duration: quickCapture.duration,
        mimeType: quickCapture.mimeType,
      });
      URL.revokeObjectURL(quickCapture.url);
      setQuickCapture(null);
      setQuickTitle('');
      setElapsed(0);
      onOpenRecording(saved.id);
    } catch (err) {
      setMicError(err instanceof Error ? err.message : 'Failed to save recording.');
    } finally {
      setSavingQuick(false);
    }
  };

  const handleQuickUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const validation = validateAudioFile(file);
    if (!validation.valid) {
      setMicError(validation.error || 'Invalid audio file.');
      return;
    }
    // Check duration quickly or pass directly to Studio
    await extractAudioDuration(file).catch(() => 0);
    onUploadFileToStudio(file);
  };

  const getActivityIcon = (type: ActivityItem['type']) => {
    if (type === 'recording') return Disc3;
    if (type === 'lyrics') return FileText;
    if (type === 'project') return FolderKanban;
    return Activity;
  };

  return (
    <div className="space-y-8">
      {/* Studio Welcome Hero */}
      <section className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-[#12141C]">
        <img
          src="/src/assets/images/studio_hero_backdrop_1794847607064.jpg"
          alt="HUMMIT analog console and vocal mic"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover opacity-35"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0B0C10]/95 via-[#0B0C10]/80 to-[#0B0C10]/55" />

        <div className="relative z-10 p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <p className="text-xs font-medium text-[#06B6D4] tracking-wide">
              HUMMIT Studio Workspace
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Welcome back, {user.display_name}. Never lose a musical idea.
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Capture melodies the moment they hit, transcribe lyrics from raw takes, and shape
              sketches into structured compositions.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('studio')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] hover:opacity-95 text-white text-sm font-semibold transition-opacity whitespace-nowrap shrink-0"
            >
              <Mic className="w-4 h-4" />
              <span>Quick Record</span>
            </button>

            <input
              ref={uploadInputRef}
              type="file"
              accept=".mp3,.wav,.m4a,.webm,.ogg,.aac,.flac,audio/*"
              onChange={handleQuickUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-4 h-4 text-[#06B6D4]" />
              <span>Upload Audio</span>
            </button>
          </div>
        </div>
      </section>

      {/* Real Database Statistics */}
      <section aria-label="Workspace metrics" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl bg-[#12141C] border border-white/[0.08] p-5 space-y-1.5">
          <p className="text-xs text-slate-400">Total Recordings</p>
          <p className="font-mono-tabular text-2xl font-semibold text-white">{recordings.length}</p>
          <p className="text-xs text-slate-500">Captured & uploaded takes</p>
        </div>

        <div className="rounded-xl bg-[#12141C] border border-white/[0.08] p-5 space-y-1.5">
          <p className="text-xs text-slate-400">Saved Ideas</p>
          <p className="font-mono-tabular text-2xl font-semibold text-white">
            {activeDrafts.length + lyrics.length}
          </p>
          <p className="text-xs text-slate-500">
            {activeDrafts.length} audio · {lyrics.length} lyric sheets
          </p>
        </div>

        <div className="rounded-xl bg-[#12141C] border border-white/[0.08] p-5 space-y-1.5">
          <p className="text-xs text-slate-400">Unfinished Compositions</p>
          <p className="font-mono-tabular text-2xl font-semibold text-white">
            {compositions.length + activeProjects.length}
          </p>
          <p className="text-xs text-slate-500">
            {compositions.length} blueprints · {activeProjects.length} active projects
          </p>
        </div>

        <div className="rounded-xl bg-[#12141C] border border-white/[0.08] p-5 space-y-1.5">
          <p className="text-xs text-slate-400">AI Analyses Saved</p>
          <p className="font-mono-tabular text-2xl font-semibold text-white">{analyses.length}</p>
          <p className="text-xs text-slate-500">Versioned audio breakdowns</p>
        </div>
      </section>

      {/* Inline Quick Recording Widget */}
      <section className="rounded-xl bg-[#12141C] border border-white/[0.08] p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">
              Instant Sketch Capture
            </h2>
            <p className="text-xs text-slate-400">
              Record a melody or riff directly here without leaving your overview.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono-tabular text-lg font-medium text-slate-200">
              {formatDuration(elapsed, true)}
            </span>

            {micStatus !== 'recording' && micStatus !== 'paused' ? (
              <button
                type="button"
                onClick={startQuickRecord}
                disabled={micStatus === 'requesting'}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                {micStatus === 'requesting' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Mic className="w-3.5 h-3.5" />
                )}
                <span>Start Recording</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={pauseOrResumeQuick}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
                >
                  {micStatus === 'paused' ? (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      <span>Resume</span>
                    </>
                  ) : (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      <span>Pause</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={stopQuickRecord}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Stop</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {micError && (
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-4 py-2.5 text-xs text-rose-300">
            {micError}
          </div>
        )}

        {!quickCapture ? (
          <LiveWaveformCanvas
            analyser={recorderRef.current?.getAnalyser() || null}
            isRecording={micStatus === 'recording'}
            isPaused={micStatus === 'paused'}
            height={88}
          />
        ) : (
          <div className="space-y-3 pt-1">
            <WaveformPlayer
              audioUrl={quickCapture.url}
              initialDuration={quickCapture.duration}
              height={64}
              compact
            />
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <input
                type="text"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                placeholder="Name this sketch..."
                className="flex-1 px-3.5 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#8B5CF6]"
              />
              <button
                type="button"
                onClick={saveQuickCapture}
                disabled={savingQuick}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                {savingQuick && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Save & Open Idea</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Main 2-Column Content: Recent Recordings & Projects + Activity */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Recent Recordings */}
        <section className="xl:col-span-2 rounded-xl bg-[#12141C] border border-white/[0.08] p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display text-lg font-semibold text-white">Recent Recordings</h2>
            <button
              type="button"
              onClick={() => onNavigate('ideas')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#A78BFA] hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              <span>View all ideas</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {recentRecordings.length === 0 ? (
            <div className="py-10 text-center space-y-3 border border-dashed border-white/[0.08] rounded-lg">
              <Disc3 className="w-8 h-8 text-slate-600 mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-300">No recordings captured yet</p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Start a live microphone recording above or open the Recording Studio to capture
                  or upload your first musical idea.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('studio')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-medium transition-colors"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>Open Recording Studio</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {recentRecordings.map((rec) => {
                const project = projects.find((p) => p.id === rec.project_id);
                const latestAnalysis = analyses.find((a) => a.recording_id === rec.id);
                return (
                  <div
                    key={rec.id}
                    className="py-3.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <button
                        type="button"
                        onClick={() => onOpenRecording(rec.id)}
                        className="text-sm font-semibold text-white hover:text-[#A78BFA] transition-colors text-left truncate block max-w-full"
                      >
                        {rec.title}
                      </button>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                        <span className="font-mono-tabular text-slate-300">
                          {formatDuration(rec.duration)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{formatRelativeDate(rec.created_at)}</span>
                        {project && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#06B6D4]">{project.name}</span>
                          </>
                        )}
                        {latestAnalysis?.mood?.length ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{latestAnalysis.mood.slice(0, 2).join(', ')}</span>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenRecording(rec.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0 self-start sm:self-center"
                    >
                      <span>Open Idea</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Recent Projects & Creative Activity */}
        <div className="space-y-6">
          <section className="rounded-xl bg-[#12141C] border border-white/[0.08] p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-display text-lg font-semibold text-white">Recent Projects</h2>
              <button
                type="button"
                onClick={() => onNavigate('projects')}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#A78BFA] hover:text-white transition-colors whitespace-nowrap shrink-0"
              >
                <span>Manage</span>
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {recentProjects.length === 0 ? (
              <div className="py-6 text-center space-y-2.5 border border-dashed border-white/[0.08] rounded-lg">
                <p className="text-xs text-slate-400">
                  Group demos, lyrics, and compositions into albums or EPs.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('projects')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-white transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Project</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {recentProjects.map((proj) => {
                  const recCount = recordings.filter((r) => r.project_id === proj.id).length;
                  return (
                    <button
                      key={proj.id}
                      type="button"
                      onClick={() => onOpenProject(proj.id)}
                      className="w-full text-left p-3 rounded-lg bg-[#0B0C10]/60 hover:bg-white/[0.05] border border-white/[0.06] transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white truncate">{proj.name}</div>
                        <div className="text-xs text-slate-400">
                          {recCount} {recCount === 1 ? 'recording' : 'recordings'} · {proj.status}
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-500 shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-xl bg-[#12141C] border border-white/[0.08] p-6 space-y-4">
            <h2 className="font-display text-lg font-semibold text-white">Creative Activity</h2>
            {activity.length === 0 ? (
              <p className="text-xs text-slate-500">
                Your studio timeline will populate as you record ideas, run AI analysis, write
                lyrics, and build compositions.
              </p>
            ) : (
              <div className="space-y-3">
                {activity.slice(0, 6).map((item) => {
                  const Icon = getActivityIcon(item.type);
                  return (
                    <div key={item.id} className="flex items-start gap-3">
                      <div className="p-1.5 rounded-md bg-white/[0.04] text-slate-400 mt-0.5 shrink-0">
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-slate-200 truncate">{item.title}</p>
                        <p className="text-[11px] text-slate-500">
                          {item.subtitle} · {formatRelativeDate(item.timestamp)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
