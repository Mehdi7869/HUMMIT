import { useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Disc3,
  Edit3,
  Heart,
  LayoutGrid,
  List,
  Mic,
  Play,
  Search,
  Trash2,
} from 'lucide-react';
import { Analysis, Favorite, NavSection, Project, Recording } from '../types/soundscribe';
import { WaveformPlayer } from '../components/WaveformPlayer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatDuration, formatFileSize, formatRelativeDate } from '../utils/formatters';

interface IdeasLibraryViewProps {
  title: string;
  subtitle: string;
  favoritesOnly?: boolean;
  recordings: Recording[];
  projects: Project[];
  analyses: Analysis[];
  favorites: Favorite[];
  resolveAudioUrl: (recording: Recording) => Promise<string>;
  onOpenRecording: (recordingId: string) => void;
  onToggleFavorite: (recordingId: string) => Promise<void>;
  onUpdateRecording: (recording: Recording) => Promise<void>;
  onDeleteRecording: (recording: Recording) => Promise<void>;
  onNavigate: (section: NavSection) => void;
}

export function IdeasLibraryView({
  title,
  subtitle,
  favoritesOnly = false,
  recordings,
  projects,
  analyses,
  favorites,
  resolveAudioUrl,
  onOpenRecording,
  onToggleFavorite,
  onUpdateRecording,
  onDeleteRecording,
  onNavigate,
}: IdeasLibraryViewProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState('');
  const [moodFilter, setMoodFilter] = useState('all');
  const [genreFilter, setGenreFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7d' | '30d'>('all');
  const [statusFilter, setStatusFilter] = useState<'draft' | 'archived' | 'all'>('draft');

  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);
  const [editingRec, setEditingRec] = useState<Recording | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editProjectId, setEditProjectId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Recording | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const favoriteSet = useMemo(
    () => new Set(favorites.map((f) => f.recording_id)),
    [favorites]
  );

  // Extract real mood & genre filter options from saved analyses
  const { availableMoods, availableGenres } = useMemo(() => {
    const moods = new Set<string>();
    const genres = new Set<string>();
    for (const a of analyses) {
      a.mood.forEach((m) => moods.add(m));
      a.genre.forEach((g) => genres.add(g));
    }
    return {
      availableMoods: Array.from(moods).sort(),
      availableGenres: Array.from(genres).sort(),
    };
  }, [analyses]);

  const filteredRecordings = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();

    return recordings.filter((rec) => {
      if (favoritesOnly && !favoriteSet.has(rec.id)) return false;
      if (statusFilter !== 'all' && rec.status !== statusFilter) return false;

      const recAnalyses = analyses.filter((a) => a.recording_id === rec.id);
      const latestAnalysis = recAnalyses[0];

      if (moodFilter !== 'all') {
        const hasMood = latestAnalysis?.mood.some(
          (m) => m.toLowerCase() === moodFilter.toLowerCase()
        );
        if (!hasMood) return false;
      }

      if (genreFilter !== 'all') {
        const hasGenre = latestAnalysis?.genre.some(
          (g) => g.toLowerCase() === genreFilter.toLowerCase()
        );
        if (!hasGenre) return false;
      }

      if (dateFilter !== 'all') {
        const createdMs = new Date(rec.created_at).getTime();
        const ageDays = (now - createdMs) / (1000 * 60 * 60 * 24);
        if (dateFilter === 'today' && ageDays > 1) return false;
        if (dateFilter === '7d' && ageDays > 7) return false;
        if (dateFilter === '30d' && ageDays > 30) return false;
      }

      if (q) {
        const haystack = [
          rec.title,
          rec.description,
          ...rec.tags,
          latestAnalysis?.transcript || '',
          ...(latestAnalysis?.mood || []),
          ...(latestAnalysis?.genre || []),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [
    recordings,
    favoritesOnly,
    favoriteSet,
    statusFilter,
    analyses,
    moodFilter,
    genreFilter,
    dateFilter,
    search,
  ]);

  const beginEdit = (rec: Recording) => {
    setEditingRec(rec);
    setEditTitle(rec.title);
    setEditDesc(rec.description);
    setEditProjectId(rec.project_id || '');
  };

  const saveEdit = async () => {
    if (!editingRec) return;
    setActionError(null);
    try {
      await onUpdateRecording({
        ...editingRec,
        title: editTitle.trim() || editingRec.title,
        description: editDesc.trim(),
        project_id: editProjectId || null,
      });
      setEditingRec(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update recording.');
    }
  };

  const handleToggleArchive = async (rec: Recording) => {
    setActionError(null);
    try {
      await onUpdateRecording({
        ...rec,
        status: rec.status === 'archived' ? 'draft' : 'archived',
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update archive status.');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setActionError(null);
    try {
      await onDeleteRecording(deleteTarget);
      setDeleteTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to delete recording.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">{title}</h1>
          <p className="text-sm text-slate-400">{subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center p-1 rounded-lg bg-[#12141C] border border-white/[0.08]">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'grid' ? 'bg-[#8B5CF6] text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-label="List view"
              className={`p-1.5 rounded-md transition-colors ${
                viewMode === 'list' ? 'bg-[#8B5CF6] text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('studio')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <Mic className="w-3.5 h-3.5" />
            <span>New Recording</span>
          </button>
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-4 py-2.5 text-xs text-rose-300">
          {actionError}
        </div>
      )}

      {/* Search & Filters */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="lg:col-span-2 relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search titles, notes, tags, transcripts..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-[#12141C] border border-white/[0.08] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#8B5CF6]"
          />
        </div>

        <select
          aria-label="Filter by mood"
          value={moodFilter}
          onChange={(e) => setMoodFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-[#12141C] border border-white/[0.08] text-xs text-slate-200 focus:outline-none focus:border-[#8B5CF6]"
        >
          <option value="all">All Moods</option>
          {availableMoods.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by genre"
          value={genreFilter}
          onChange={(e) => setGenreFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-[#12141C] border border-white/[0.08] text-xs text-slate-200 focus:outline-none focus:border-[#8B5CF6]"
        >
          <option value="all">All Genres</option>
          {availableGenres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          <select
            aria-label="Filter by date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}
            className="flex-1 px-3 py-2 rounded-lg bg-[#12141C] border border-white/[0.08] text-xs text-slate-200 focus:outline-none focus:border-[#8B5CF6]"
          >
            <option value="all">Any Date</option>
            <option value="today">Today</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>

          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="flex-1 px-3 py-2 rounded-lg bg-[#12141C] border border-white/[0.08] text-xs text-slate-200 focus:outline-none focus:border-[#8B5CF6]"
          >
            <option value="draft">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      {/* Empty States */}
      {filteredRecordings.length === 0 ? (
        <div className="rounded-xl bg-[#12141C] border border-dashed border-white/[0.1] p-12 text-center space-y-3">
          <Disc3 className="w-10 h-10 text-slate-600 mx-auto" />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-white">
              {recordings.length === 0
                ? 'Your musical library is empty'
                : favoritesOnly && favoriteSet.size === 0
                  ? 'No favorite recordings yet'
                  : 'No recordings match your filters'}
            </h2>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              {recordings.length === 0
                ? 'Record a live sketch or import an audio file in the Recording Studio to build your library.'
                : favoritesOnly && favoriteSet.size === 0
                  ? 'Tap the heart icon on any recording in My Ideas to pin your strongest takes here.'
                  : 'Adjust your search terms or clear active mood, genre, date, or archive filters.'}
            </p>
          </div>
          <div className="flex justify-center gap-2.5 pt-1">
            {recordings.length === 0 ? (
              <button
                type="button"
                onClick={() => onNavigate('studio')}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>Go to Recording Studio</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setMoodFilter('all');
                  setGenreFilter('all');
                  setDateFilter('all');
                  setStatusFilter('all');
                }}
                className="px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-white transition-colors"
              >
                Reset Filters
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          className={
            viewMode === 'grid'
              ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4'
              : 'space-y-3'
          }
        >
          {filteredRecordings.map((rec) => {
            const isFav = favoriteSet.has(rec.id);
            const project = projects.find((p) => p.id === rec.project_id);
            const latestAnalysis = analyses.find((a) => a.recording_id === rec.id);
            const isExpanded = expandedPlayerId === rec.id;

            return (
              <article
                key={rec.id}
                className="rounded-xl bg-[#12141C] border border-white/[0.08] p-5 space-y-3.5 flex flex-col justify-between"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenRecording(rec.id)}
                      className="text-left text-base font-semibold text-white hover:text-[#A78BFA] transition-colors line-clamp-1"
                    >
                      {rec.title}
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onToggleFavorite(rec.id)}
                        aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                        className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors"
                      >
                        <Heart
                          className={`w-4 h-4 ${
                            isFav ? 'fill-rose-500 text-rose-500' : 'text-slate-400'
                          }`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => beginEdit(rec)}
                        aria-label="Edit recording details"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleArchive(rec)}
                        aria-label={rec.status === 'archived' ? 'Restore from archive' : 'Archive recording'}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                      >
                        {rec.status === 'archived' ? (
                          <ArchiveRestore className="w-4 h-4 text-[#06B6D4]" />
                        ) : (
                          <Archive className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(rec)}
                        aria-label="Delete recording"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Clean unboxed metadata row */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                    <span className="font-mono-tabular text-slate-200">
                      {formatDuration(rec.duration)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatFileSize(rec.file_size)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatRelativeDate(rec.created_at)}</span>
                    {project && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#06B6D4]">{project.name}</span>
                      </>
                    )}
                    {rec.status === 'archived' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-amber-400">Archived</span>
                      </>
                    )}
                  </div>

                  {rec.description && (
                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                      {rec.description}
                    </p>
                  )}

                  {(rec.tags.length > 0 || latestAnalysis) && (
                    <div className="text-xs text-slate-500 space-y-0.5">
                      {rec.tags.length > 0 && (
                        <p className="truncate">{rec.tags.map((t) => `#${t}`).join('  ')}</p>
                      )}
                      {latestAnalysis && (
                        <p className="text-slate-400 truncate">
                          AI: {[...latestAnalysis.mood.slice(0, 2), ...latestAnalysis.genre.slice(0, 2)].join(' · ') || 'Analyzed'}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {isExpanded && (
                  <div className="pt-1">
                    <WaveformPlayer
                      resolveAudioUrl={() => resolveAudioUrl(rec)}
                      initialDuration={rec.duration}
                      height={54}
                      compact
                    />
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => setExpandedPlayerId(isExpanded ? null : rec.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs font-medium text-slate-200 transition-colors whitespace-nowrap"
                  >
                    <Play className="w-3.5 h-3.5 text-[#06B6D4]" />
                    <span>{isExpanded ? 'Hide Player' : 'Play Waveform'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenRecording(rec.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#8B5CF6]/15 hover:bg-[#8B5CF6]/25 text-xs font-semibold text-[#C4B5FD] transition-colors whitespace-nowrap"
                  >
                    <span>Analyze & Develop</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Edit Recording Modal */}
      {editingRec && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl bg-[#141720] border border-white/10 p-6 space-y-4">
            <h3 className="font-display text-lg font-semibold text-white">Edit Recording</h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300">Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300">Description</label>
                <textarea
                  rows={3}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300">Project</label>
                <select
                  value={editProjectId}
                  onChange={(e) => setEditProjectId(e.target.value)}
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
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingRec(null)}
                className="px-4 py-2 rounded-lg bg-white/[0.06] text-xs font-medium text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                className="px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-xs font-semibold text-white"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete "${deleteTarget?.title}"?`}
        description="This permanently deletes the audio file, waveform metadata, and any linked analyses. This action cannot be undone."
        confirmLabel="Delete Permanently"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
