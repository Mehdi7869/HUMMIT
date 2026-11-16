import { FormEvent, useState } from 'react';
import {
  ArrowRight,
  Disc3,
  Edit3,
  FileText,
  FolderKanban,
  Layers,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  Composition,
  Lyrics,
  NavSection,
  Project,
  ProjectStatus,
  Recording,
  User,
} from '../types/soundscribe';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatDuration, formatRelativeDate } from '../utils/formatters';

interface ProjectsViewProps {
  user: User;
  projects: Project[];
  recordings: Recording[];
  lyrics: Lyrics[];
  compositions: Composition[];
  initialSelectedProjectId?: string | null;
  onSaveProject: (project: Project) => Promise<Project>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onAssignRecording: (recording: Recording, projectId: string | null) => Promise<void>;
  onOpenRecording: (recordingId: string) => void;
  onNavigate: (section: NavSection) => void;
}

const PROJECT_COLORS = ['#8B5CF6', '#3B82F6', '#06B6D4', '#F43F5E', '#10B981'];

export function ProjectsView({
  user,
  projects,
  recordings,
  lyrics,
  compositions,
  initialSelectedProjectId,
  onSaveProject,
  onDeleteProject,
  onAssignRecording,
  onOpenRecording,
  onNavigate,
}: ProjectsViewProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    initialSelectedProjectId || projects[0]?.id || null
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('active');
  const [coverColor, setCoverColor] = useState(PROJECT_COLORS[0]);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [assignRecId, setAssignRecId] = useState('');

  const activeProject =
    projects.find((p) => p.id === selectedProjectId) || projects[0] || null;

  const openCreateModal = () => {
    setEditingProject(null);
    setName('');
    setDescription('');
    setStatus('active');
    setCoverColor(PROJECT_COLORS[0]);
    setModalOpen(true);
  };

  const openEditModal = (project: Project) => {
    setEditingProject(project);
    setName(project.name);
    setDescription(project.description);
    setStatus(project.status);
    setCoverColor(project.cover_color || PROJECT_COLORS[0]);
    setModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const now = new Date().toISOString();
    const saved = await onSaveProject({
      id: editingProject?.id || crypto.randomUUID(),
      user_id: user.id,
      name: name.trim(),
      description: description.trim(),
      status,
      cover_color: coverColor,
      created_at: editingProject?.created_at || now,
      updated_at: now,
    });
    setSelectedProjectId(saved.id);
    setModalOpen(false);
  };

  const projectRecordings = activeProject
    ? recordings.filter((r) => r.project_id === activeProject.id)
    : [];
  const projectLyrics = activeProject
    ? lyrics.filter((l) => l.project_id === activeProject.id)
    : [];
  const projectCompositions = activeProject
    ? compositions.filter((c) => c.project_id === activeProject.id)
    : [];
  const unassignedRecordings = recordings.filter((r) => r.project_id !== activeProject?.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Projects</h1>
          <p className="text-sm text-slate-400">
            Organize recordings, lyric sheets, and composition blueprints into EPs, albums, or
            sessions.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New Project</span>
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-xl bg-[#12141C] border border-dashed border-white/[0.1] p-12 text-center space-y-3">
          <FolderKanban className="w-10 h-10 text-slate-600 mx-auto" />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-white">No projects created yet</h2>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Create your first project to group related demos, lyric drafts, and song arrangements.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold"
          >
            <Plus className="w-4 h-4" />
            <span>Create First Project</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Project List */}
          <div className="lg:col-span-4 space-y-2.5">
            {projects.map((p) => {
              const active = activeProject?.id === p.id;
              const recCount = recordings.filter((r) => r.project_id === p.id).length;
              const lyrCount = lyrics.filter((l) => l.project_id === p.id).length;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedProjectId(p.id)}
                  className={`w-full text-left p-4 rounded-xl border transition-colors flex items-start gap-3 ${
                    active
                      ? 'bg-[#171A24] border-[#8B5CF6]/50'
                      : 'bg-[#12141C] border-white/[0.08] hover:bg-white/[0.03]'
                  }`}
                >
                  <img
                    src="/src/assets/images/studio_album_art_1794847608795.jpg"
                    alt=""
                    referrerPolicy="no-referrer"
                    className="w-11 h-11 rounded-lg object-cover shrink-0 border border-white/10"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-sm font-semibold text-white truncate">{p.name}</div>
                    <div className="text-xs text-slate-400">
                      {recCount} recordings · {lyrCount} lyrics · {p.status}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected Project Detail */}
          {activeProject && (
            <section className="lg:col-span-8 rounded-xl bg-[#12141C] border border-white/[0.08] p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-white/[0.06]">
                <div className="space-y-1.5">
                  <div className="text-xs text-[#06B6D4] capitalize">{activeProject.status} project</div>
                  <h2 className="font-display text-2xl font-bold text-white">
                    {activeProject.name}
                  </h2>
                  {activeProject.description && (
                    <p className="text-sm text-slate-400 leading-relaxed">
                      {activeProject.description}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditModal(activeProject)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-white"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(activeProject)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-xs font-medium text-rose-300"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>

              {/* Assign existing recording to project */}
              {unassignedRecordings.length > 0 && (
                <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
                  <select
                    aria-label="Assign existing recording to project"
                    value={assignRecId}
                    onChange={(e) => setAssignRecId(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-slate-200"
                  >
                    <option value="">Link an existing recording to this project...</option>
                    {unassignedRecordings.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title} ({formatDuration(r.duration)})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!assignRecId}
                    onClick={async () => {
                      const target = recordings.find((r) => r.id === assignRecId);
                      if (target) {
                        await onAssignRecording(target, activeProject.id);
                        setAssignRecId('');
                      }
                    }}
                    className="px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 text-xs font-semibold text-white whitespace-nowrap shrink-0"
                  >
                    Link Recording
                  </button>
                </div>
              )}

              {/* Recordings in Project */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Disc3 className="w-3.5 h-3.5" />
                  <span>Recordings ({projectRecordings.length})</span>
                </h3>
                {projectRecordings.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No recordings linked yet. Assign one above or select this project when saving in
                    the Recording Studio.
                  </p>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {projectRecordings.map((rec) => (
                      <div
                        key={rec.id}
                        className="py-3 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => onOpenRecording(rec.id)}
                            className="text-sm font-medium text-white hover:text-[#A78BFA] truncate block"
                          >
                            {rec.title}
                          </button>
                          <div className="text-xs text-slate-400 font-mono-tabular">
                            {formatDuration(rec.duration)} · {formatRelativeDate(rec.created_at)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => onAssignRecording(rec, null)}
                            className="text-xs text-slate-500 hover:text-slate-300"
                          >
                            Unlink
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenRecording(rec.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/[0.06] text-xs text-white"
                          >
                            <span>Open</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Linked Lyrics & Compositions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2 border-t border-white/[0.06]">
                <div className="space-y-2.5">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5" />
                    <span>Lyrics ({projectLyrics.length})</span>
                  </h3>
                  {projectLyrics.length === 0 ? (
                    <p className="text-xs text-slate-500">No lyrics linked to this project.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {projectLyrics.map((l) => (
                        <li key={l.id}>
                          <button
                            type="button"
                            onClick={() => onNavigate('lyrics')}
                            className="text-xs text-slate-200 hover:text-[#A78BFA]"
                          >
                            {l.title} (v{l.version})
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="space-y-2.5">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5" />
                    <span>Compositions ({projectCompositions.length})</span>
                  </h3>
                  {projectCompositions.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No composition blueprints linked yet.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {projectCompositions.map((c) => (
                        <li key={c.id} className="text-xs text-slate-200">
                          {c.recording_id ? (
                            <button
                              type="button"
                              onClick={() => onOpenRecording(c.recording_id!)}
                              className="hover:text-[#A78BFA]"
                            >
                              {c.title} (v{c.version})
                            </button>
                          ) : (
                            <span>
                              {c.title} (v{c.version})
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      {/* Create / Edit Project Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-md rounded-xl bg-[#141720] border border-white/10 p-6 space-y-4"
          >
            <h3 className="font-display text-lg font-semibold text-white">
              {editingProject ? 'Edit Project' : 'New Music Project'}
            </h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300">Project Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Autumn Acoustic EP"
                  className="w-full px-3.5 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300">Description</label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Sonic palette, target instrumentation, or album theme..."
                  className="w-full px-3.5 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                    className="w-full px-3 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-white"
                  >
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">Accent Color</label>
                  <div className="flex items-center gap-2 pt-1.5">
                    {PROJECT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCoverColor(c)}
                        aria-label={`Select color ${c}`}
                        className={`w-6 h-6 rounded-md transition-transform ${
                          coverColor === c ? 'ring-2 ring-white scale-110' : 'opacity-70'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-white/[0.06] text-xs font-medium text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-xs font-semibold text-white"
              >
                {editingProject ? 'Save Project' : 'Create Project'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete project "${deleteTarget?.name}"?`}
        description="Recordings and lyric sheets inside this project will stay in your library as ungrouped items."
        confirmLabel="Delete Project"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) {
            await onDeleteProject(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
