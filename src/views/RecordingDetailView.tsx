import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Edit3,
  FileText,
  Heart,
  Layers,
  Loader2,
  Music,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  Analysis,
  ChordProgressionSuggestion,
  Composition,
  CompositionSection,
  Lyrics,
  Project,
  Recording,
  User,
} from '../types/soundscribe';
import { requestAudioAnalysis, requestDevelopIdea } from '../services/aiClient';
import { exportCompositionPdf, exportCompositionTxt } from '../services/exportService';
import { WaveformPlayer } from '../components/WaveformPlayer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatDuration, formatFileSize, formatRelativeDate } from '../utils/formatters';

interface RecordingDetailViewProps {
  user: User;
  recording: Recording;
  projects: Project[];
  analyses: Analysis[];
  compositions: Composition[];
  isFavorite: boolean;
  resolveAudioUrl: (recording: Recording) => Promise<string>;
  getAudioBlob: (recording: Recording) => Promise<Blob>;
  onBack: () => void;
  onToggleFavorite: (recordingId: string) => Promise<void>;
  onUpdateRecording: (recording: Recording) => Promise<void>;
  onDeleteRecording: (recording: Recording) => Promise<void>;
  onSaveAnalysis: (analysis: Analysis) => Promise<Analysis>;
  onSaveComposition: (composition: Composition) => Promise<Composition>;
  onSaveLyricsSheet: (lyrics: Lyrics) => Promise<Lyrics>;
  onOpenLyricsWorkspace: () => void;
}

export function RecordingDetailView({
  user,
  recording,
  projects,
  analyses,
  compositions,
  isFavorite,
  resolveAudioUrl,
  getAudioBlob,
  onBack,
  onToggleFavorite,
  onUpdateRecording,
  onDeleteRecording,
  onSaveAnalysis,
  onSaveComposition,
  onSaveLyricsSheet,
  onOpenLyricsWorkspace,
}: RecordingDetailViewProps) {
  // Recording metadata editing
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaTitle, setMetaTitle] = useState(recording.title);
  const [metaDesc, setMetaDesc] = useState(recording.description);
  const [metaTags, setMetaTags] = useState(recording.tags.join(', '));
  const [metaProjectId, setMetaProjectId] = useState(recording.project_id || '');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Audio Analysis state
  const recordingAnalyses = useMemo(
    () =>
      analyses
        .filter((a) => a.recording_id === recording.id)
        .sort((a, b) => b.version - a.version),
    [analyses, recording.id]
  );
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(
    recordingAnalyses[0]?.id || null
  );
  const activeAnalysis =
    recordingAnalyses.find((a) => a.id === selectedAnalysisId) || recordingAnalyses[0] || null;

  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [editableTranscript, setEditableTranscript] = useState(activeAnalysis?.transcript || '');
  const [selectedMood, setSelectedMood] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('');
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Composition / Develop My Idea state
  const recordingCompositions = useMemo(
    () =>
      compositions
        .filter((c) => c.recording_id === recording.id)
        .sort((a, b) => b.version - a.version),
    [compositions, recording.id]
  );
  const [selectedCompId, setSelectedCompId] = useState<string | null>(
    recordingCompositions[0]?.id || null
  );
  const [developing, setDeveloping] = useState(false);
  const [developError, setDevelopError] = useState<string | null>(null);
  const [savingComp, setSavingComp] = useState(false);

  // Editable draft composition fields
  const [draftComp, setDraftComp] = useState<Composition | null>(
    recordingCompositions[0] || null
  );
  const [newInstrument, setNewInstrument] = useState('');

  useEffect(() => {
    setMetaTitle(recording.title);
    setMetaDesc(recording.description);
    setMetaTags(recording.tags.join(', '));
    setMetaProjectId(recording.project_id || '');
  }, [recording]);

  useEffect(() => {
    if (activeAnalysis) {
      setEditableTranscript(activeAnalysis.analysis_json.lyrics || activeAnalysis.transcript || '');
      setSelectedMood(activeAnalysis.mood[0] || '');
      setSelectedGenre(activeAnalysis.genre[0] || '');
    }
  }, [activeAnalysis?.id]);

  useEffect(() => {
    const matched =
      recordingCompositions.find((c) => c.id === selectedCompId) || recordingCompositions[0] || null;
    if (matched) {
      setDraftComp(structuredClone(matched));
    }
  }, [selectedCompId, recordingCompositions.length]);

  const handleSaveMeta = async () => {
    const parsedTags = metaTags
      .split(',')
      .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
      .filter(Boolean);

    await onUpdateRecording({
      ...recording,
      title: metaTitle.trim() || recording.title,
      description: metaDesc.trim(),
      tags: parsedTags,
      project_id: metaProjectId || null,
    });
    setEditingMeta(false);
    setStatusNotice('Recording details updated.');
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    setAnalysisError(null);
    setStatusNotice(null);

    try {
      const audioBlob = await getAudioBlob(recording);
      const result = await requestAudioAnalysis({
        audioBlob,
        mimeType: recording.mime_type,
        title: recording.title,
        notes: recording.description,
        duration: recording.duration,
      });

      const nextVersion =
        recordingAnalyses.reduce((max, a) => Math.max(max, a.version), 0) + 1;

      const saved = await onSaveAnalysis({
        id: crypto.randomUUID(),
        recording_id: recording.id,
        user_id: user.id,
        version: nextVersion,
        transcript: result.transcription || result.lyrics || '',
        mood: result.mood || [],
        genre: result.possible_genres || [],
        estimated_bpm: result.estimated_tempo || null,
        analysis_json: result,
        created_at: new Date().toISOString(),
      });

      setSelectedAnalysisId(saved.id);
      setEditableTranscript(result.lyrics || result.transcription || '');
      setSelectedMood(result.mood[0] || '');
      setSelectedGenre(result.possible_genres[0] || '');
      setStatusNotice(`Saved AI Audio Analysis v${nextVersion}. Original recording preserved.`);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Audio analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  };

  const sendTranscriptToLyrics = async () => {
    const now = new Date().toISOString();
    await onSaveLyricsSheet({
      id: crypto.randomUUID(),
      user_id: user.id,
      recording_id: recording.id,
      project_id: recording.project_id,
      title: `${recording.title} (Lyrics)`,
      content: editableTranscript,
      sections: [
        {
          id: crypto.randomUUID(),
          type: 'verse',
          label: 'Transcribed Draft',
          content: editableTranscript,
        },
      ],
      notes: `Created from ${recording.title} transcription`,
      version: 1,
      created_at: now,
      updated_at: now,
    });
    setStatusNotice('Saved transcription as a new Lyric Sheet in Lyrics Workspace.');
  };

  const runDevelopIdea = async () => {
    setDeveloping(true);
    setDevelopError(null);
    setStatusNotice(null);

    try {
      let audioBlob: Blob | null = null;
      try {
        audioBlob = await getAudioBlob(recording);
      } catch {
        audioBlob = null;
      }

      const plan = await requestDevelopIdea({
        audioBlob,
        mimeType: recording.mime_type,
        title: recording.title,
        notes: recording.description,
        transcript: activeAnalysis?.transcript || editableTranscript,
        lyrics: editableTranscript || activeAnalysis?.analysis_json.lyrics,
        mood: selectedMood ? [selectedMood] : activeAnalysis?.mood || [],
        genre: selectedGenre ? [selectedGenre] : activeAnalysis?.genre || [],
        analysisSummary: activeAnalysis?.analysis_json.audio_summary,
        creativeFocus: user.ai_preferences?.creativeFocus,
      });

      const nextVersion =
        recordingCompositions.reduce((max, c) => Math.max(max, c.version), 0) + 1;
      const now = new Date().toISOString();

      const newComp: Composition = {
        id: crypto.randomUUID(),
        user_id: user.id,
        recording_id: recording.id,
        project_id: recording.project_id,
        title: plan.suggested_title || `${recording.title} Blueprint`,
        version: nextVersion,
        structure_json: {
          creative_concept: plan.creative_concept,
          song_description: plan.song_description,
          sections: plan.structure.map((s) => ({
            id: crypto.randomUUID(),
            name: s.name,
            purpose: s.purpose,
            energy_notes: s.energy_notes,
            lyric_focus: s.lyric_focus,
          })),
          arrangement_notes: plan.arrangement_notes,
          tempo_recommendations: plan.tempo_recommendations,
          vocal_performance_suggestions: plan.vocal_performance_suggestions,
          next_creative_steps: plan.next_creative_steps || [],
        },
        chord_suggestions: plan.chord_suggestions.map((c) => ({
          id: crypto.randomUUID(),
          section_name: c.section_name,
          chords: c.chords,
          harmonic_feel: c.harmonic_feel,
          is_ai_suggestion: true,
        })),
        instrument_suggestions: plan.instrument_suggestions || [],
        lyrics_content: editableTranscript || activeAnalysis?.analysis_json.lyrics || '',
        creative_notes: recording.description || '',
        created_at: now,
        updated_at: now,
      };

      const saved = await onSaveComposition(newComp);
      setSelectedCompId(saved.id);
      setDraftComp(structuredClone(saved));
      setStatusNotice(`Created Composition Blueprint v${nextVersion}.`);
    } catch (err) {
      setDevelopError(err instanceof Error ? err.message : 'Failed to develop idea.');
    } finally {
      setDeveloping(false);
    }
  };

  const saveCompositionVersion = async (asNewVersion: boolean) => {
    if (!draftComp) return;
    setSavingComp(true);
    setStatusNotice(null);
    try {
      const now = new Date().toISOString();
      const nextVersion = asNewVersion
        ? recordingCompositions.reduce((max, c) => Math.max(max, c.version), 0) + 1
        : draftComp.version;

      const toSave: Composition = {
        ...draftComp,
        id: asNewVersion ? crypto.randomUUID() : draftComp.id,
        version: nextVersion,
        updated_at: now,
        created_at: asNewVersion ? now : draftComp.created_at,
      };

      const saved = await onSaveComposition(toSave);
      setSelectedCompId(saved.id);
      setDraftComp(structuredClone(saved));
      setStatusNotice(
        asNewVersion
          ? `Saved new composition version v${nextVersion}. Previous versions preserved.`
          : `Updated composition v${saved.version}.`
      );
    } finally {
      setSavingComp(false);
    }
  };

  const updateSection = (id: string, patch: Partial<CompositionSection>) => {
    if (!draftComp) return;
    setDraftComp({
      ...draftComp,
      structure_json: {
        ...draftComp.structure_json,
        sections: draftComp.structure_json.sections.map((s) =>
          s.id === id ? { ...s, ...patch } : s
        ),
      },
    });
  };

  const addSection = () => {
    if (!draftComp) return;
    setDraftComp({
      ...draftComp,
      structure_json: {
        ...draftComp.structure_json,
        sections: [
          ...draftComp.structure_json.sections,
          {
            id: crypto.randomUUID(),
            name: 'New Section',
            purpose: '',
            energy_notes: '',
            lyric_focus: '',
          },
        ],
      },
    });
  };

  const updateChord = (id: string, patch: Partial<ChordProgressionSuggestion>) => {
    if (!draftComp) return;
    setDraftComp({
      ...draftComp,
      chord_suggestions: draftComp.chord_suggestions.map((c) =>
        c.id === id ? { ...c, ...patch } : c
      ),
    });
  };

  const addChordRow = () => {
    if (!draftComp) return;
    setDraftComp({
      ...draftComp,
      chord_suggestions: [
        ...draftComp.chord_suggestions,
        {
          id: crypto.randomUUID(),
          section_name: 'Verse / Chorus',
          chords: 'Am - F - C - G',
          harmonic_feel: 'Custom progression',
          is_ai_suggestion: false,
        },
      ],
    });
  };

  const project = projects.find((p) => p.id === recording.project_id);

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Library</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleFavorite(recording.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#12141C] border border-white/[0.08] hover:bg-white/[0.06] text-xs font-medium text-slate-200 transition-colors"
          >
            <Heart
              className={`w-3.5 h-3.5 ${isFavorite ? 'fill-rose-500 text-rose-500' : 'text-slate-400'}`}
            />
            <span>{isFavorite ? 'Favorited' : 'Favorite'}</span>
          </button>

          <button
            type="button"
            onClick={() => setEditingMeta((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#12141C] border border-white/[0.08] hover:bg-white/[0.06] text-xs font-medium text-slate-200 transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Edit Details</span>
          </button>

          <button
            type="button"
            onClick={() => setConfirmDeleteOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 text-xs font-medium text-rose-300 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        </div>
      </div>

      {statusNotice && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-xs text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusNotice}</span>
        </div>
      )}

      {/* Recording Overview & Waveform Player */}
      <section className="rounded-xl bg-[#12141C] border border-white/[0.08] p-6 space-y-5">
        {editingMeta ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300">Title</label>
                <input
                  type="text"
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300">Project</label>
                <select
                  value={metaProjectId}
                  onChange={(e) => setMetaProjectId(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
                >
                  <option value="">No Project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-300">Notes</label>
              <textarea
                rows={3}
                value={metaDesc}
                onChange={(e) => setMetaDesc(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-300">Tags (comma separated)</label>
              <input
                type="text"
                value={metaTags}
                onChange={(e) => setMetaTags(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingMeta(false)}
                className="px-4 py-2 rounded-lg bg-white/[0.06] text-xs font-medium text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveMeta}
                className="px-4 py-2 rounded-lg bg-[#8B5CF6] text-xs font-semibold text-white"
              >
                Save Metadata
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div className="space-y-2">
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">
                {recording.title}
              </h1>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400">
                <span className="font-mono-tabular text-slate-200">
                  {formatDuration(recording.duration)}
                </span>
                <span aria-hidden="true">·</span>
                <span>{formatFileSize(recording.file_size)}</span>
                <span aria-hidden="true">·</span>
                <span>{recording.mime_type.split(';')[0]}</span>
                <span aria-hidden="true">·</span>
                <span>Saved {formatRelativeDate(recording.created_at)}</span>
                {project && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#06B6D4]">{project.name}</span>
                  </>
                )}
              </div>
              {recording.description && (
                <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">
                  {recording.description}
                </p>
              )}
              {recording.tags.length > 0 && (
                <p className="text-xs text-slate-500">
                  {recording.tags.map((t) => `#${t}`).join('  ')}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={runAnalysis}
                disabled={analyzing}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-50 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                {analyzing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                <span>{recordingAnalyses.length > 0 ? 'RE-ANALYZE' : 'ANALYZE'}</span>
              </button>

              <button
                type="button"
                onClick={runDevelopIdea}
                disabled={developing}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#06B6D4] hover:opacity-95 disabled:opacity-50 text-white text-xs font-semibold transition-opacity whitespace-nowrap"
              >
                {developing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Layers className="w-4 h-4" />
                )}
                <span>DEVELOP MY IDEA</span>
              </button>
            </div>
          </div>
        )}

        <WaveformPlayer
          resolveAudioUrl={() => resolveAudioUrl(recording)}
          initialDuration={recording.duration}
          height={96}
        />
      </section>

      {/* AI AUDIO ANALYSIS SECTION */}
      <section className="rounded-xl bg-[#12141C] border border-white/[0.08] p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">
              Gemini Audio Analysis
            </h2>
            <p className="text-xs text-slate-400">
              Inspect actual audio characteristics, transcription, mood, instruments, and creative
              directions. All versions are preserved.
            </p>
          </div>

          {recordingAnalyses.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="analysis-version" className="text-xs text-slate-400">
                Version:
              </label>
              <select
                id="analysis-version"
                value={activeAnalysis?.id || ''}
                onChange={(e) => setSelectedAnalysisId(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-white focus:outline-none focus:border-[#8B5CF6]"
              >
                {recordingAnalyses.map((a) => (
                  <option key={a.id} value={a.id}>
                    v{a.version} · {formatRelativeDate(a.created_at)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {analysisError && (
          <div
            role="alert"
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-xs text-rose-300"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{analysisError}</span>
            </div>
            <button
              type="button"
              onClick={runAnalysis}
              disabled={analyzing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium whitespace-nowrap self-start sm:self-center"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Analysis</span>
            </button>
          </div>
        )}

        {analyzing && (
          <div className="py-10 text-center space-y-2.5 border border-white/[0.06] rounded-lg bg-[#090A0E]/50">
            <Loader2 className="w-7 h-7 animate-spin text-[#06B6D4] mx-auto" />
            <p className="text-sm font-medium text-white">
              Sending audio to Gemini for acoustic & lyrical analysis...
            </p>
            <p className="text-xs text-slate-400">
              Your original recording remains untouched.
            </p>
          </div>
        )}

        {!analyzing && !activeAnalysis && (
          <div className="py-8 text-center space-y-3 border border-dashed border-white/[0.08] rounded-lg">
            <Music className="w-8 h-8 text-slate-600 mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-200">No AI analysis saved yet</p>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Click ANALYZE above to send the actual audio recording to Gemini for vocal/lyric
                transcription, mood & genre impressions, and instrumentation cues.
              </p>
            </div>
          </div>
        )}

        {!analyzing && activeAnalysis && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Audio Summary
                  </h3>
                  <p className="text-sm text-slate-200 leading-relaxed">
                    {activeAnalysis.analysis_json.audio_summary}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/[0.06]">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-400 mb-1">Detected Moods</h3>
                    <p className="text-sm text-slate-200">
                      {activeAnalysis.analysis_json.mood.join(' · ') || '—'}
                    </p>
                    {activeAnalysis.analysis_json.mood.length > 0 && (
                      <select
                        aria-label="Select mood for Develop My Idea"
                        value={selectedMood}
                        onChange={(e) => setSelectedMood(e.target.value)}
                        className="mt-2 w-full px-2.5 py-1.5 rounded-md bg-[#090A0E] border border-white/[0.08] text-xs text-slate-300"
                      >
                        <option value="">Use all moods</option>
                        {activeAnalysis.analysis_json.mood.map((m) => (
                          <option key={m} value={m}>
                            Focus mood: {m}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold text-slate-400 mb-1">Possible Genres</h3>
                    <p className="text-sm text-slate-200">
                      {activeAnalysis.analysis_json.possible_genres.join(' · ') || '—'}
                    </p>
                    {activeAnalysis.analysis_json.possible_genres.length > 0 && (
                      <select
                        aria-label="Select genre for Develop My Idea"
                        value={selectedGenre}
                        onChange={(e) => setSelectedGenre(e.target.value)}
                        className="mt-2 w-full px-2.5 py-1.5 rounded-md bg-[#090A0E] border border-white/[0.08] text-xs text-slate-300"
                      >
                        <option value="">Use all genres</option>
                        {activeAnalysis.analysis_json.possible_genres.map((g) => (
                          <option key={g} value={g}>
                            Focus genre: {g}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/[0.06]">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-400 mb-1">
                      Audible Instruments
                    </h3>
                    <p className="text-sm text-slate-200">
                      {activeAnalysis.analysis_json.possible_instruments.join(', ') || 'None detected'}
                    </p>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold text-slate-400 mb-1">
                      Tempo & Rhythm Feel
                    </h3>
                    <p className="text-sm text-slate-200">
                      {activeAnalysis.analysis_json.estimated_tempo || 'Tempo unmeasured / free-time'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      {activeAnalysis.analysis_json.rhythm_description}
                    </p>
                  </div>
                </div>
              </div>

              {/* Editable Transcription & Lyrics */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="editable-transcript"
                    className="text-xs font-semibold text-slate-400 uppercase tracking-wider"
                  >
                    Editable Transcription & Extracted Lyrics
                  </label>
                  <button
                    type="button"
                    onClick={sendTranscriptToLyrics}
                    disabled={!editableTranscript.trim()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.06] hover:bg-white/[0.12] disabled:opacity-40 text-xs text-[#A78BFA] transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Save to Lyrics Workspace</span>
                  </button>
                </div>

                <textarea
                  id="editable-transcript"
                  rows={8}
                  value={editableTranscript}
                  onChange={(e) => setEditableTranscript(e.target.value)}
                  placeholder="No intelligible sung or spoken words detected."
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#090A0E] border border-white/[0.1] text-sm text-slate-200 leading-relaxed focus:outline-none focus:border-[#8B5CF6]"
                />
                <div className="flex justify-between items-center text-[11px] text-slate-500">
                  <span>Raw AI transcript: {activeAnalysis.analysis_json.transcription || '—'}</span>
                  <button
                    type="button"
                    onClick={onOpenLyricsWorkspace}
                    className="text-[#06B6D4] hover:underline"
                  >
                    Open Lyrics Workspace
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-4 border-t border-white/[0.06]">
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold text-slate-400">Musical Characteristics</h3>
                <ul className="space-y-1 text-xs text-slate-300 list-disc pl-4">
                  {activeAnalysis.analysis_json.musical_characteristics.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold text-slate-400">Creative Recommendations</h3>
                <ul className="space-y-1 text-xs text-slate-300 list-disc pl-4">
                  {activeAnalysis.analysis_json.creative_recommendations.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold text-slate-400">Confidence & Limitations</h3>
                <ul className="space-y-1 text-xs text-slate-400 list-disc pl-4">
                  {activeAnalysis.analysis_json.confidence_notes.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* DEVELOP MY IDEA / EDITABLE COMPOSITION WORKSPACE */}
      <section className="rounded-xl bg-[#12141C] border border-white/[0.08] p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">
              Composition Development Workspace
            </h2>
            <p className="text-xs text-slate-400">
              Generate an editable songwriting blueprint using your audio, analysis, lyrics, and
              notes. Save multiple versions and export as TXT or PDF.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {recordingCompositions.length > 0 && (
              <select
                aria-label="Select composition version"
                value={draftComp?.id || ''}
                onChange={(e) => setSelectedCompId(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-white"
              >
                {recordingCompositions.map((c) => (
                  <option key={c.id} value={c.id}>
                    v{c.version} · {c.title}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={runDevelopIdea}
              disabled={developing}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-xs font-semibold transition-colors whitespace-nowrap"
            >
              {developing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Layers className="w-3.5 h-3.5" />
              )}
              <span>{draftComp ? 'Generate New Blueprint' : 'Develop My Idea'}</span>
            </button>
          </div>
        </div>

        {developError && (
          <div
            role="alert"
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-xs text-rose-300"
          >
            <span>{developError}</span>
            <button
              type="button"
              onClick={runDevelopIdea}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 text-white font-medium whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {developing && (
          <div className="py-10 text-center space-y-2.5 border border-white/[0.06] rounded-lg bg-[#090A0E]/50">
            <Loader2 className="w-7 h-7 animate-spin text-[#8B5CF6] mx-auto" />
            <p className="text-sm font-medium text-white">
              Building arrangement structure, AI chord suggestions, and production notes...
            </p>
          </div>
        )}

        {!developing && !draftComp && (
          <div className="py-10 text-center space-y-3 border border-dashed border-white/[0.08] rounded-lg">
            <Layers className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Click <strong>DEVELOP MY IDEA</strong> to turn this recording into a full editable
              song blueprint with Intro, Verse, Pre-Chorus, Chorus, Bridge, Outro, chord
              progressions, and instrumentation ideas.
            </p>
          </div>
        )}

        {!developing && draftComp && (
          <div className="space-y-6">
            {/* Save & Export Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/[0.06]">
              <span className="text-xs text-slate-400 font-mono-tabular">
                Editing Composition v{draftComp.version}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => saveCompositionVersion(false)}
                  disabled={savingComp}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] text-xs font-medium text-white transition-colors"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save v{draftComp.version}</span>
                </button>
                <button
                  type="button"
                  onClick={() => saveCompositionVersion(true)}
                  disabled={savingComp}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3B82F6] hover:bg-[#2563EB] text-xs font-semibold text-white transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Save as New Version</span>
                </button>
                <button
                  type="button"
                  onClick={() => exportCompositionTxt(draftComp)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs text-slate-200 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export TXT</span>
                </button>
                <button
                  type="button"
                  onClick={() => exportCompositionPdf(draftComp)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs text-slate-200 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-[#06B6D4]" />
                  <span>Export PDF</span>
                </button>
              </div>
            </div>

            {/* Song Title, Concept, Description */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">Song Title</label>
                  <input
                    type="text"
                    value={draftComp.title}
                    onChange={(e) => setDraftComp({ ...draftComp, title: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-sm font-semibold text-white focus:outline-none focus:border-[#8B5CF6]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">Creative Concept</label>
                  <textarea
                    rows={3}
                    value={draftComp.structure_json.creative_concept}
                    onChange={(e) =>
                      setDraftComp({
                        ...draftComp,
                        structure_json: {
                          ...draftComp.structure_json,
                          creative_concept: e.target.value,
                        },
                      })
                    }
                    className="w-full px-3.5 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-slate-200 focus:outline-none focus:border-[#8B5CF6]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300">Song Description</label>
                <textarea
                  rows={6}
                  value={draftComp.structure_json.song_description}
                  onChange={(e) =>
                    setDraftComp({
                      ...draftComp,
                      structure_json: {
                        ...draftComp.structure_json,
                        song_description: e.target.value,
                      },
                    })
                  }
                  className="w-full px-3.5 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-slate-200 leading-relaxed focus:outline-none focus:border-[#8B5CF6]"
                />
              </div>
            </div>

            {/* Editable Song Structure */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Song Structure</h3>
                <button
                  type="button"
                  onClick={addSection}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#A78BFA] hover:text-white"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Section</span>
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {draftComp.structure_json.sections.map((section) => (
                  <div
                    key={section.id}
                    className="rounded-lg bg-[#090A0E] border border-white/[0.08] p-4 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        value={section.name}
                        onChange={(e) => updateSection(section.id, { name: e.target.value })}
                        className="font-semibold text-xs text-[#06B6D4] bg-transparent border-b border-transparent focus:border-[#8B5CF6] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setDraftComp({
                            ...draftComp,
                            structure_json: {
                              ...draftComp.structure_json,
                              sections: draftComp.structure_json.sections.filter(
                                (s) => s.id !== section.id
                              ),
                            },
                          })
                        }
                        aria-label={`Remove ${section.name}`}
                        className="text-slate-500 hover:text-rose-400 text-xs"
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      type="text"
                      value={section.purpose}
                      onChange={(e) => updateSection(section.id, { purpose: e.target.value })}
                      placeholder="Section purpose..."
                      className="w-full px-2.5 py-1.5 rounded bg-[#12141C] border border-white/[0.06] text-xs text-slate-200 focus:outline-none focus:border-[#8B5CF6]"
                    />
                    <input
                      type="text"
                      value={section.energy_notes}
                      onChange={(e) => updateSection(section.id, { energy_notes: e.target.value })}
                      placeholder="Energy & instrumentation cues..."
                      className="w-full px-2.5 py-1.5 rounded bg-[#12141C] border border-white/[0.06] text-xs text-slate-300 focus:outline-none focus:border-[#8B5CF6]"
                    />
                    <input
                      type="text"
                      value={section.lyric_focus}
                      onChange={(e) => updateSection(section.id, { lyric_focus: e.target.value })}
                      placeholder="Lyric theme / hook idea..."
                      className="w-full px-2.5 py-1.5 rounded bg-[#12141C] border border-white/[0.06] text-xs text-slate-300 focus:outline-none focus:border-[#8B5CF6]"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* AI-Generated Chord Progression Suggestions */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Chord Progression Ideas (AI-Generated Suggestions)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Starting harmonic progressions — edit freely to match your instrument and key.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addChordRow}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#A78BFA] hover:text-white"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Progression</span>
                </button>
              </div>

              <div className="space-y-2">
                {draftComp.chord_suggestions.map((chord) => (
                  <div
                    key={chord.id}
                    className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center p-3 rounded-lg bg-[#090A0E] border border-white/[0.08]"
                  >
                    <input
                      type="text"
                      value={chord.section_name}
                      onChange={(e) => updateChord(chord.id, { section_name: e.target.value })}
                      className="md:col-span-3 px-2.5 py-1.5 rounded bg-[#12141C] border border-white/[0.06] text-xs font-medium text-white"
                    />
                    <input
                      type="text"
                      value={chord.chords}
                      onChange={(e) => updateChord(chord.id, { chords: e.target.value })}
                      className="md:col-span-4 px-2.5 py-1.5 rounded bg-[#12141C] border border-white/[0.06] font-mono-tabular text-xs font-semibold text-[#06B6D4]"
                    />
                    <input
                      type="text"
                      value={chord.harmonic_feel}
                      onChange={(e) => updateChord(chord.id, { harmonic_feel: e.target.value })}
                      className="md:col-span-4 px-2.5 py-1.5 rounded bg-[#12141C] border border-white/[0.06] text-xs text-slate-300"
                    />
                    <div className="md:col-span-1 flex items-center justify-end gap-2">
                      <span className="text-[10px] text-slate-500">
                        {chord.is_ai_suggestion ? 'AI' : 'Edit'}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setDraftComp({
                            ...draftComp,
                            chord_suggestions: draftComp.chord_suggestions.filter(
                              (c) => c.id !== chord.id
                            ),
                          })
                        }
                        aria-label="Remove chord progression"
                        className="text-slate-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Instruments, Arrangement, Tempo, Vocals */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-300">
                  Suggested Instruments
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newInstrument}
                    onChange={(e) => setNewInstrument(e.target.value)}
                    placeholder="Add instrument (e.g., Rhodes electric piano)"
                    className="flex-1 px-3 py-1.5 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newInstrument.trim()) return;
                      setDraftComp({
                        ...draftComp,
                        instrument_suggestions: [
                          ...draftComp.instrument_suggestions,
                          newInstrument.trim(),
                        ],
                      });
                      setNewInstrument('');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white/[0.07] text-xs text-white"
                  >
                    Add
                  </button>
                </div>
                <div className="space-y-1 pt-1">
                  {draftComp.instrument_suggestions.map((inst, idx) => (
                    <div
                      key={`${inst}-${idx}`}
                      className="flex items-center justify-between text-xs text-slate-300 py-1 border-b border-white/[0.05]"
                    >
                      <span>{inst}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setDraftComp({
                            ...draftComp,
                            instrument_suggestions: draftComp.instrument_suggestions.filter(
                              (_, i) => i !== idx
                            ),
                          })
                        }
                        className="text-slate-500 hover:text-rose-400"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">Arrangement Notes</label>
                  <textarea
                    rows={3}
                    value={draftComp.structure_json.arrangement_notes}
                    onChange={(e) =>
                      setDraftComp({
                        ...draftComp,
                        structure_json: {
                          ...draftComp.structure_json,
                          arrangement_notes: e.target.value,
                        },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-slate-200"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">
                    Tempo Recommendations
                  </label>
                  <input
                    type="text"
                    value={draftComp.structure_json.tempo_recommendations}
                    onChange={(e) =>
                      setDraftComp({
                        ...draftComp,
                        structure_json: {
                          ...draftComp.structure_json,
                          tempo_recommendations: e.target.value,
                        },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-slate-200"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">
                    Vocal & Performance Suggestions
                  </label>
                  <textarea
                    rows={2}
                    value={draftComp.structure_json.vocal_performance_suggestions}
                    onChange={(e) =>
                      setDraftComp({
                        ...draftComp,
                        structure_json: {
                          ...draftComp.structure_json,
                          vocal_performance_suggestions: e.target.value,
                        },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-slate-200"
                  />
                </div>
              </div>
            </div>

            {/* Editable Lyrics & Creative Notes */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 border-t border-white/[0.06]">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300">Working Lyrics</label>
                <textarea
                  rows={6}
                  value={draftComp.lyrics_content}
                  onChange={(e) => setDraftComp({ ...draftComp, lyrics_content: e.target.value })}
                  placeholder="Write or refine lyrics for this composition..."
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-slate-200 leading-relaxed"
                />
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">Creative Notes</label>
                  <textarea
                    rows={4}
                    value={draftComp.creative_notes}
                    onChange={(e) =>
                      setDraftComp({ ...draftComp, creative_notes: e.target.value })
                    }
                    placeholder="Recording microphone placement, reference tracks, mix ideas..."
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-slate-200 leading-relaxed"
                  />
                </div>

                {draftComp.structure_json.next_creative_steps.length > 0 && (
                  <div className="space-y-1">
                    <h4 className="text-xs font-semibold text-slate-400">Next Creative Steps</h4>
                    <ul className="space-y-1 text-xs text-slate-300 list-disc pl-4">
                      {draftComp.structure_json.next_creative_steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={`Delete "${recording.title}"?`}
        description="This permanently deletes the audio recording, stored file, and associated analyses. Any separate Lyric Sheets you created will remain."
        confirmLabel="Delete Recording"
        destructive
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={async () => {
          await onDeleteRecording(recording);
          setConfirmDeleteOpen(false);
          onBack();
        }}
      />
    </div>
  );
}
