import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  FileText,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  Lyrics,
  LyricSection,
  LyricSectionType,
  Project,
  Recording,
  User,
} from '../types/soundscribe';
import { requestLyricAssist } from '../services/aiClient';
import { exportLyricsPdf, exportLyricsTxt } from '../services/exportService';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatRelativeDate } from '../utils/formatters';

interface LyricsWorkspaceViewProps {
  user: User;
  lyricsList: Lyrics[];
  projects: Project[];
  recordings: Recording[];
  onSaveLyrics: (lyrics: Lyrics) => Promise<Lyrics>;
  onDeleteLyrics: (lyricsId: string) => Promise<void>;
}

const DEFAULT_SECTIONS = (): LyricSection[] => [
  { id: crypto.randomUUID(), type: 'verse', label: 'Verse 1', content: '' },
  { id: crypto.randomUUID(), type: 'chorus', label: 'Chorus', content: '' },
  { id: crypto.randomUUID(), type: 'bridge', label: 'Bridge', content: '' },
  { id: crypto.randomUUID(), type: 'outro', label: 'Outro', content: '' },
];

export function LyricsWorkspaceView({
  user,
  lyricsList,
  projects,
  recordings,
  onSaveLyrics,
  onDeleteLyrics,
}: LyricsWorkspaceViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(lyricsList[0]?.id || null);
  const [draft, setDraft] = useState<Lyrics>(() => {
    if (lyricsList[0]) return structuredClone(lyricsList[0]);
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      user_id: user.id,
      recording_id: null,
      project_id: null,
      title: 'Untitled Song Lyrics',
      content: '',
      sections: DEFAULT_SECTIONS(),
      notes: '',
      version: 1,
      created_at: now,
      updated_at: now,
    };
  });

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Lyrics | null>(null);

  // AI Lyric Assistant state
  const [selectedLines, setSelectedLines] = useState('');
  const [targetTone, setTargetTone] = useState('intimate and poetic');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<
    Array<{ label: string; text: string; rationale: string }>
  >([]);

  const compiledContent = useMemo(
    () => draft.sections.map((s) => `[${s.label}]\n${s.content}`).join('\n\n'),
    [draft.sections]
  );

  const selectDocument = (doc: Lyrics) => {
    setSelectedId(doc.id);
    setDraft(structuredClone(doc));
    setAiSuggestions([]);
    setNotice(null);
  };

  const createNewSheet = () => {
    const now = new Date().toISOString();
    const fresh: Lyrics = {
      id: crypto.randomUUID(),
      user_id: user.id,
      recording_id: null,
      project_id: null,
      title: 'New Lyric Sheet',
      content: '',
      sections: DEFAULT_SECTIONS(),
      notes: '',
      version: 1,
      created_at: now,
      updated_at: now,
    };
    setSelectedId(null);
    setDraft(fresh);
    setAiSuggestions([]);
    setNotice(null);
  };

  const handleSave = async (asNewVersion: boolean) => {
    setSaving(true);
    setNotice(null);
    try {
      const now = new Date().toISOString();
      const sameFamilyMax = lyricsList
        .filter((l) => l.title.toLowerCase() === draft.title.trim().toLowerCase())
        .reduce((max, l) => Math.max(max, l.version), 0);

      const nextVersion = asNewVersion ? Math.max(draft.version, sameFamilyMax) + 1 : draft.version;
      const toSave: Lyrics = {
        ...draft,
        id: asNewVersion ? crypto.randomUUID() : draft.id,
        title: draft.title.trim() || 'Untitled Song Lyrics',
        content: compiledContent,
        version: nextVersion,
        parent_id: asNewVersion ? draft.id : draft.parent_id,
        created_at: asNewVersion ? now : draft.created_at,
        updated_at: now,
      };
      const saved = await onSaveLyrics(toSave);
      setSelectedId(saved.id);
      setDraft(structuredClone(saved));
      setNotice(
        asNewVersion
          ? `Saved new version v${saved.version}. Earlier drafts are preserved.`
          : `Saved "${saved.title}" (v${saved.version}).`
      );
    } finally {
      setSaving(false);
    }
  };

  const addSection = (type: LyricSectionType) => {
    const count = draft.sections.filter((s) => s.type === type).length + 1;
    const labelMap: Record<LyricSectionType, string> = {
      intro: 'Intro',
      verse: `Verse ${count}`,
      'pre-chorus': 'Pre-Chorus',
      chorus: count > 1 ? `Chorus ${count}` : 'Chorus',
      bridge: 'Bridge',
      outro: 'Outro',
    };
    setDraft({
      ...draft,
      sections: [
        ...draft.sections,
        { id: crypto.randomUUID(), type, label: labelMap[type], content: '' },
      ],
    });
  };

  const updateSection = (id: string, patch: Partial<LyricSection>) => {
    setDraft({
      ...draft,
      sections: draft.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  };

  const runAiAssist = async (action: 'continue' | 'rewrite' | 'chorus' | 'rhymes' | 'tone') => {
    setAiLoading(true);
    setAiError(null);
    try {
      const suggestions = await requestLyricAssist({
        action,
        title: draft.title,
        currentLyrics: compiledContent,
        selectedText: selectedLines || undefined,
        targetTone: action === 'tone' ? targetTone : undefined,
      });
      setAiSuggestions(suggestions);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Lyric AI request failed.');
    } finally {
      setAiLoading(false);
    }
  };

  const appendSuggestionAsSection = (label: string, text: string) => {
    setDraft({
      ...draft,
      sections: [
        ...draft.sections,
        {
          id: crypto.randomUUID(),
          type: 'verse',
          label: `AI Draft — ${label}`,
          content: text,
        },
      ],
    });
    setNotice('Added AI suggestion as a new section without altering your original verses.');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Lyrics Workspace</h1>
          <p className="text-sm text-slate-400">
            Structure verses, choruses, bridges, and outros with version history and AI lyric
            brainstorming.
          </p>
        </div>

        <button
          type="button"
          onClick={createNewSheet}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New Lyric Sheet</span>
        </button>
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-xs text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Saved Lyric Sheets List */}
        <aside className="xl:col-span-3 rounded-xl bg-[#12141C] border border-white/[0.08] p-4 space-y-3 h-fit">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Saved Lyric Sheets ({lyricsList.length})
          </h2>

          {lyricsList.length === 0 ? (
            <p className="text-xs text-slate-500 py-4">
              No saved lyric sheets yet. Write your song on the right and click Save.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
              {lyricsList.map((doc) => {
                const active = selectedId === doc.id;
                return (
                  <div
                    key={doc.id}
                    className={`flex items-center justify-between gap-2 p-2.5 rounded-lg border transition-colors ${
                      active
                        ? 'bg-[#8B5CF6]/15 border-[#8B5CF6]/30 text-white'
                        : 'bg-[#090A0E]/60 border-white/[0.05] text-slate-300 hover:bg-white/[0.04]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => selectDocument(doc)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="text-xs font-semibold truncate">{doc.title}</div>
                      <div className="text-[11px] text-slate-500 font-mono-tabular">
                        v{doc.version} · {formatRelativeDate(doc.updated_at)}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(doc)}
                      aria-label={`Delete ${doc.title}`}
                      className="p-1 text-slate-500 hover:text-rose-400 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        {/* Main Editor */}
        <section className="xl:col-span-5 rounded-xl bg-[#12141C] border border-white/[0.08] p-5 space-y-5">
          <div className="space-y-3">
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Song Title..."
              className="w-full px-3.5 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] font-display text-lg font-bold text-white focus:outline-none focus:border-[#8B5CF6]"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <select
                aria-label="Link to project"
                value={draft.project_id || ''}
                onChange={(e) => setDraft({ ...draft, project_id: e.target.value || null })}
                className="px-3 py-1.5 rounded-lg bg-[#090A0E] border border-white/[0.08] text-xs text-slate-200"
              >
                <option value="">No Linked Project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    Project: {p.name}
                  </option>
                ))}
              </select>

              <select
                aria-label="Link to recording"
                value={draft.recording_id || ''}
                onChange={(e) => setDraft({ ...draft, recording_id: e.target.value || null })}
                className="px-3 py-1.5 rounded-lg bg-[#090A0E] border border-white/[0.08] text-xs text-slate-200"
              >
                <option value="">No Linked Recording</option>
                {recordings.map((r) => (
                  <option key={r.id} value={r.id}>
                    Audio: {r.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Add Section Toolbar */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(['intro', 'verse', 'pre-chorus', 'chorus', 'bridge', 'outro'] as LyricSectionType[]).map(
              (type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addSection(type)}
                  className="px-2.5 py-1 rounded-md bg-white/[0.05] hover:bg-white/[0.1] text-[11px] font-medium text-slate-300 capitalize transition-colors"
                >
                  + {type}
                </button>
              )
            )}
          </div>

          {/* Sections */}
          <div className="space-y-3">
            {draft.sections.map((section) => (
              <div
                key={section.id}
                className="rounded-lg bg-[#090A0E] border border-white/[0.08] p-3.5 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={section.label}
                    onChange={(e) => updateSection(section.id, { label: e.target.value })}
                    className="text-xs font-semibold text-[#06B6D4] bg-transparent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        sections: draft.sections.filter((s) => s.id !== section.id),
                      })
                    }
                    className="text-[11px] text-slate-500 hover:text-rose-400"
                  >
                    Remove
                  </button>
                </div>

                <textarea
                  rows={4}
                  value={section.content}
                  onChange={(e) => updateSection(section.id, { content: e.target.value })}
                  placeholder={`Write ${section.label.toLowerCase()} lines here...`}
                  className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none leading-relaxed resize-y"
                />
              </div>
            ))}
          </div>

          {/* Save, Versioning & Export */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/[0.06]">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleSave(false)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-xs font-semibold text-white"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>Save v{draft.version}</span>
              </button>
              <button
                type="button"
                onClick={() => handleSave(true)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] text-xs font-medium text-white"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Save New Version</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => exportLyricsTxt({ ...draft, content: compiledContent })}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs text-slate-300"
              >
                <Download className="w-3.5 h-3.5" />
                <span>TXT</span>
              </button>
              <button
                type="button"
                onClick={() => exportLyricsPdf({ ...draft, content: compiledContent })}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs text-slate-300"
              >
                <Download className="w-3.5 h-3.5 text-[#06B6D4]" />
                <span>PDF</span>
              </button>
            </div>
          </div>
        </section>

        {/* AI Lyric Assistant */}
        <section className="xl:col-span-4 rounded-xl bg-[#12141C] border border-white/[0.08] p-5 space-y-4 h-fit">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#A78BFA]" />
            <h2 className="font-display text-base font-semibold text-white">
              AI Lyric Co-Writer
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            Explore continuations, rewrites, rhymes, and tone shifts without altering your original
            draft.
          </p>

          <div className="space-y-1.5">
            <label htmlFor="lyric-focus" className="text-xs font-medium text-slate-300">
              Focus Lines (optional — paste lines to rewrite or rhyme)
            </label>
            <textarea
              id="lyric-focus"
              rows={3}
              value={selectedLines}
              onChange={(e) => setSelectedLines(e.target.value)}
              placeholder="Paste a couplet or chorus hook here..."
              className="w-full px-3 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-[#8B5CF6]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => runAiAssist('continue')}
              disabled={aiLoading}
              className="px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-white text-left"
            >
              Continue Lyrics
            </button>
            <button
              type="button"
              onClick={() => runAiAssist('rewrite')}
              disabled={aiLoading}
              className="px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-white text-left"
            >
              Rewrite Lines
            </button>
            <button
              type="button"
              onClick={() => runAiAssist('chorus')}
              disabled={aiLoading}
              className="px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-white text-left"
            >
              Alt Choruses
            </button>
            <button
              type="button"
              onClick={() => runAiAssist('rhymes')}
              disabled={aiLoading}
              className="px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-white text-left"
            >
              Suggest Rhymes
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={targetTone}
              onChange={(e) => setTargetTone(e.target.value)}
              placeholder="Target tone (e.g. defiant, nostalgic)"
              className="flex-1 px-3 py-1.5 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-white"
            />
            <button
              type="button"
              onClick={() => runAiAssist('tone')}
              disabled={aiLoading}
              className="px-3 py-1.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-xs font-semibold text-white whitespace-nowrap shrink-0"
            >
              Shift Tone
            </button>
          </div>

          {aiError && (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300">
              {aiError}
            </div>
          )}

          {aiLoading && (
            <div className="py-6 flex items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-[#8B5CF6]" />
              <span>Crafting lyric ideas with Gemini...</span>
            </div>
          )}

          {!aiLoading && aiSuggestions.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-white/[0.06]">
              {aiSuggestions.map((item, idx) => (
                <div
                  key={idx}
                  className="rounded-lg bg-[#090A0E] border border-white/[0.08] p-3.5 space-y-2"
                >
                  <div className="text-xs font-semibold text-[#06B6D4]">{item.label}</div>
                  <pre className="whitespace-pre-wrap font-sans text-xs text-slate-200 leading-relaxed">
                    {item.text}
                  </pre>
                  <p className="text-[11px] text-slate-500">{item.rationale}</p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => appendSuggestionAsSection(item.label, item.text)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#8B5CF6]/20 hover:bg-[#8B5CF6]/30 text-[11px] font-medium text-[#C4B5FD]"
                    >
                      <FileText className="w-3 h-3" />
                      <span>Insert as Section</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(item.text)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-[11px] text-slate-300"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete "${deleteTarget?.title}"?`}
        description="This permanently deletes this saved lyric sheet."
        confirmLabel="Delete Lyric Sheet"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) {
            await onDeleteLyrics(deleteTarget.id);
            if (selectedId === deleteTarget.id) createNewSheet();
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
