import { ChangeEvent, DragEvent, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Save,
  Square,
  Tag,
  Upload,
  X,
} from 'lucide-react';
import { Project, Recording, User } from '../types/hummit';
import {
  AudioDeviceOption,
  CapturedAudio,
  extractAudioDuration,
  listAudioInputDevices,
  mapMicError,
  MicrophoneRecorder,
  MicStatus,
  validateAudioFile,
} from '../services/audioEngine';
import { LiveWaveformCanvas } from '../components/LiveWaveformCanvas';
import { WaveformPlayer } from '../components/WaveformPlayer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatDuration, formatFileSize } from '../utils/formatters';

interface RecordingStudioViewProps {
  user: User;
  projects: Project[];
  pendingUploadFile: File | null;
  onClearPendingUpload: () => void;
  onSaveRecording: (params: {
    title: string;
    description: string;
    tags: string[];
    projectId: string | null;
    blob: Blob;
    duration: number;
    mimeType: string;
  }) => Promise<Recording>;
  onOpenRecording: (recordingId: string) => void;
}

export function RecordingStudioView({
  user,
  projects,
  pendingUploadFile,
  onClearPendingUpload,
  onSaveRecording,
  onOpenRecording,
}: RecordingStudioViewProps) {
  const recorderRef = useRef<MicrophoneRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [devices, setDevices] = useState<AudioDeviceOption[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(
    user.audio_preferences?.preferredInputId || ''
  );
  const [micStatus, setMicStatus] = useState<MicStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [elapsed, setElapsed] = useState(0);
  const [captured, setCaptured] = useState<CapturedAudio | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Metadata fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [projectId, setProjectId] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [confirmReRecordOpen, setConfirmReRecordOpen] = useState(false);

  useEffect(() => {
    listAudioInputDevices().then(setDevices);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      recorderRef.current?.discard();
    };
  }, []);

  // Revoke object URL when replaced or unmounted
  useEffect(() => {
    const currentUrl = captured?.url;
    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [captured]);

  // Handle file passed from Dashboard Upload Audio button
  useEffect(() => {
    if (pendingUploadFile) {
      processUploadedFile(pendingUploadFile);
      onClearPendingUpload();
    }
  }, [pendingUploadFile]);

  const handleStartRecording = async () => {
    if (micStatus === 'recording' || micStatus === 'paused') return;
    setErrorMsg(null);
    setStatusMsg(null);

    if (captured) {
      setConfirmReRecordOpen(true);
      return;
    }

    await beginMicCapture();
  };

  const beginMicCapture = async () => {
    setCaptured(null);
    const recorder = new MicrophoneRecorder();
    recorderRef.current = recorder;
    setMicStatus('requesting');

    try {
      await recorder.requestAndStart(selectedDeviceId || undefined);
      setMicStatus('recording');
      setElapsed(0);
      listAudioInputDevices().then(setDevices);

      timerRef.current = window.setInterval(() => {
        setElapsed(recorder.getElapsedSeconds());
      }, 80);
    } catch (err) {
      const mapped = mapMicError(err);
      setMicStatus(mapped.status);
      setErrorMsg(mapped.message);
      recorder.discard();
    }
  };

  const handlePause = () => {
    if (micStatus !== 'recording') return;
    recorderRef.current?.pause();
    setMicStatus('paused');
  };

  const handleResume = () => {
    if (micStatus !== 'paused') return;
    recorderRef.current?.resume();
    setMicStatus('recording');
  };

  const handleStop = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      const result = await recorder.stop();
      setCaptured(result);
      setMicStatus('ready');
      if (!title.trim()) {
        setTitle(
          `Studio Take ${new Date().toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        );
      }
      setStatusMsg('Recording captured. Preview the waveform below before saving.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not finalize recording.');
      setMicStatus('error');
    }
  };

  const processUploadedFile = async (file: File) => {
    setErrorMsg(null);
    setStatusMsg(null);

    if (micStatus === 'recording' || micStatus === 'paused') {
      setErrorMsg('Stop your active microphone recording before uploading an audio file.');
      return;
    }

    const validation = validateAudioFile(file);
    if (!validation.valid) {
      setErrorMsg(validation.error || 'Unsupported audio file.');
      return;
    }

    setUploadProgress(20);
    try {
      // Read buffer to verify readability and show real progress
      await file.arrayBuffer();
      setUploadProgress(65);
      const duration = await extractAudioDuration(file);
      setUploadProgress(100);

      const url = URL.createObjectURL(file);
      setCaptured({
        blob: file,
        url,
        duration,
        mimeType: validation.mimeType,
        fileSize: file.size,
      });

      if (!title.trim()) {
        const cleanName = file.name.replace(/\.[^/.]+$/, '');
        setTitle(cleanName);
      }
      setStatusMsg(`Loaded "${file.name}" (${formatFileSize(file.size)}). Ready to preview & save.`);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to read or decode the selected audio file.'
      );
    } finally {
      window.setTimeout(() => setUploadProgress(null), 400);
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) processUploadedFile(file);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processUploadedFile(file);
  };

  const addTag = () => {
    const cleaned = tagInput.trim().toLowerCase().replace(/^#/, '');
    if (cleaned && !tags.includes(cleaned)) {
      setTags((prev) => [...prev, cleaned]);
    }
    setTagInput('');
  };

  const handleSave = async (openAfterSave: boolean) => {
    if (!captured) {
      setErrorMsg('Record or upload audio before saving.');
      return;
    }
    setErrorMsg(null);
    setSaving(true);
    try {
      const saved = await onSaveRecording({
        title: title.trim() || 'Untitled Musical Idea',
        description,
        tags,
        projectId: projectId || null,
        blob: captured.blob,
        duration: captured.duration,
        mimeType: captured.mimeType,
      });

      // Reset studio for next take without affecting previously saved recordings
      setCaptured(null);
      setTitle('');
      setDescription('');
      setTags([]);
      setElapsed(0);
      setStatusMsg(`Saved "${saved.title}" to your library.`);

      if (openAfterSave) {
        onOpenRecording(saved.id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save recording.');
    } finally {
      setSaving(false);
    }
  };

  const micStatusLabel: Record<MicStatus, string> = {
    idle: 'Microphone ready to connect',
    requesting: 'Requesting microphone permission...',
    ready: 'Microphone connected',
    recording: 'Recording live audio',
    paused: 'Recording paused',
    denied: 'Microphone permission denied',
    unavailable: 'No microphone detected',
    error: 'Microphone error',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Recording Studio</h1>
          <p className="text-sm text-slate-400">
            Capture live microphone sketches or import existing audio stems to your library.
          </p>
        </div>

        {/* Microphone connection & device selector */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#12141C] border border-white/[0.08] text-xs text-slate-300">
            {micStatus === 'denied' || micStatus === 'unavailable' || micStatus === 'error' ? (
              <MicOff className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            ) : (
              <Mic
                className={`w-3.5 h-3.5 shrink-0 ${
                  micStatus === 'recording' ? 'text-rose-400' : 'text-[#06B6D4]'
                }`}
              />
            )}
            <span>{micStatusLabel[micStatus]}</span>
          </div>

          {devices.length > 0 && (
            <select
              aria-label="Select microphone input"
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              disabled={micStatus === 'recording' || micStatus === 'paused'}
              className="px-3 py-1.5 rounded-lg bg-[#12141C] border border-white/[0.08] text-xs text-slate-200 max-w-[220px] truncate focus:outline-none focus:border-[#8B5CF6]"
            >
              <option value="">Default Microphone</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-sm text-rose-300"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {statusMsg && !errorMsg && (
        <div className="flex items-start gap-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Main Studio Deck */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          {/* Transport & Waveform Console */}
          <section className="rounded-xl bg-[#12141C] border border-white/[0.08] p-6 space-y-6">
            {/* Timer & Central Mic Transport */}
            <div className="flex flex-col items-center text-center space-y-5 py-2">
              <div className="font-mono-tabular text-4xl sm:text-5xl font-semibold tracking-tight text-white">
                {captured && micStatus !== 'recording' && micStatus !== 'paused'
                  ? formatDuration(captured.duration, true)
                  : formatDuration(elapsed, true)}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3">
                {micStatus !== 'recording' && micStatus !== 'paused' ? (
                  <button
                    type="button"
                    onClick={handleStartRecording}
                    disabled={micStatus === 'requesting'}
                    className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-gradient-to-r from-rose-600 to-[#F43F5E] hover:opacity-95 disabled:opacity-50 text-white text-sm font-semibold shadow-lg transition-opacity whitespace-nowrap"
                  >
                    {micStatus === 'requesting' ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Mic className="w-5 h-5" />
                    )}
                    <span>{captured ? 'Re-record Take' : 'Start Recording'}</span>
                  </button>
                ) : (
                  <>
                    {micStatus === 'recording' ? (
                      <button
                        type="button"
                        onClick={handlePause}
                        className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] text-white text-sm font-medium transition-colors whitespace-nowrap"
                      >
                        <Pause className="w-4 h-4" />
                        <span>Pause</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleResume}
                        className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-white text-sm font-semibold transition-colors whitespace-nowrap"
                      >
                        <Play className="w-4 h-4" />
                        <span>Resume</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handleStop}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-semibold transition-colors whitespace-nowrap"
                    >
                      <Square className="w-4 h-4" />
                      <span>Stop & Preview</span>
                    </button>
                  </>
                )}

                {captured && micStatus !== 'recording' && micStatus !== 'paused' && (
                  <button
                    type="button"
                    onClick={() => setConfirmReRecordOpen(true)}
                    className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 text-sm font-medium transition-colors whitespace-nowrap"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Clear Take</span>
                  </button>
                )}
              </div>
            </div>

            {/* Waveform Stage */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                  {captured && micStatus !== 'recording' && micStatus !== 'paused'
                    ? 'Interactive Waveform Preview (click anywhere to seek)'
                    : 'Live Input Waveform'}
                </span>
                {captured && (
                  <span className="font-mono-tabular">
                    {captured.mimeType.split(';')[0]} · {formatFileSize(captured.fileSize)}
                  </span>
                )}
              </div>

              {captured && micStatus !== 'recording' && micStatus !== 'paused' ? (
                <WaveformPlayer
                  audioUrl={captured.url}
                  initialDuration={captured.duration}
                  height={96}
                />
              ) : (
                <LiveWaveformCanvas
                  analyser={recorderRef.current?.getAnalyser() || null}
                  isRecording={micStatus === 'recording'}
                  isPaused={micStatus === 'paused'}
                  height={140}
                />
              )}
            </div>
          </section>

          {/* Audio Upload Dropzone */}
          <section
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`rounded-xl border border-dashed p-6 transition-colors ${
              isDragging
                ? 'border-[#06B6D4] bg-[#06B6D4]/10'
                : 'border-white/[0.14] bg-[#12141C]/60'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3,.wav,.m4a,.webm,.ogg,.aac,.flac,audio/*"
              onChange={handleFileInputChange}
              className="hidden"
            />
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3.5 text-center sm:text-left">
                <div className="p-2.5 rounded-lg bg-[#06B6D4]/15 text-[#06B6D4] shrink-0">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Import Existing Audio</h2>
                  <p className="text-xs text-slate-400">
                    Drag & drop or choose MP3, WAV, M4A, WebM, OGG, AAC, or FLAC (max 50 MB).
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={micStatus === 'recording' || micStatus === 'paused'}
                className="px-4 py-2 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] disabled:opacity-40 border border-white/[0.1] text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0"
              >
                Upload Audio File
              </button>
            </div>

            {uploadProgress !== null && (
              <div className="mt-4 space-y-1.5">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Decoding audio waveform...</span>
                  <span className="font-mono-tabular">{uploadProgress}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#06B6D4] transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Metadata & Save Panel */}
        <section className="rounded-xl bg-[#12141C] border border-white/[0.08] p-6 space-y-5 h-fit">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">Recording Details</h2>
            <p className="text-xs text-slate-400">
              Add context so your future self and AI analysis know what you captured.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="studio-title" className="block text-xs font-medium text-slate-300">
                Recording Title
              </label>
              <input
                id="studio-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Late Night Acoustic Riff"
                className="w-full px-3.5 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="studio-notes" className="block text-xs font-medium text-slate-300">
                Notes & Tuning / Idea Context
              </label>
              <textarea
                id="studio-notes"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Capo 3, fingerpicked progression, chorus melody idea..."
                className="w-full px-3.5 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#8B5CF6] resize-y"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="studio-project" className="block text-xs font-medium text-slate-300">
                Project Association
              </label>
              <select
                id="studio-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
              >
                <option value="">Standalone Idea (No Project)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="studio-tags" className="block text-xs font-medium text-slate-300">
                Tags
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Tag className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="studio-tags"
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder="acoustic, chorus, demo"
                    className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#8B5CF6]"
                  />
                </div>
                <button
                  type="button"
                  onClick={addTag}
                  className="px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0"
                >
                  Add
                </button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-slate-300">
                  {tags.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1">
                      <span>#{t}</span>
                      <button
                        type="button"
                        onClick={() => setTags((prev) => prev.filter((item) => item !== t))}
                        aria-label={`Remove tag ${t}`}
                        className="text-slate-500 hover:text-rose-400"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="pt-2 space-y-2.5">
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={!captured || saving}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] hover:opacity-95 disabled:opacity-40 text-white text-sm font-semibold transition-opacity"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>Save & Open AI Workspace</span>
            </button>

            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={!captured || saving}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-40 text-slate-200 text-xs font-medium transition-colors"
            >
              <span>Save & Stay in Studio</span>
            </button>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirmReRecordOpen}
        title="Discard unsaved preview take?"
        description="This clears only the unsaved preview take currently in the studio. Previously saved recordings in your library are untouched."
        confirmLabel="Clear Preview"
        destructive
        onCancel={() => setConfirmReRecordOpen(false)}
        onConfirm={() => {
          setConfirmReRecordOpen(false);
          setCaptured(null);
          setElapsed(0);
          setStatusMsg(null);
        }}
      />
    </div>
  );
}
