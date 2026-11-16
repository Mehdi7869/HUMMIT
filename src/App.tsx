import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Menu, Mic } from 'lucide-react';
import {
  Analysis,
  BackendMode,
  Composition,
  Favorite,
  Lyrics,
  NavSection,
  Project,
  Recording,
  User,
} from './types/soundscribe';
import { dataService, getBackendMode } from './services/dataService';
import { getSupabaseClient, isSupabaseConfigured } from './services/supabaseClient';
import { AuthGate } from './components/AuthGate';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './views/DashboardView';
import { RecordingStudioView } from './views/RecordingStudioView';
import { IdeasLibraryView } from './views/IdeasLibraryView';
import { RecordingDetailView } from './views/RecordingDetailView';
import { LyricsWorkspaceView } from './views/LyricsWorkspaceView';
import { ProjectsView } from './views/ProjectsView';
import { AssistantView } from './views/AssistantView';
import { SettingsView } from './views/SettingsView';

const SECTION_TITLES: Record<NavSection, string> = {
  dashboard: 'Dashboard',
  studio: 'Recording Studio',
  ideas: 'My Ideas',
  lyrics: 'Lyrics Workspace',
  projects: 'Projects',
  assistant: 'AI Music Assistant',
  favorites: 'Favorites',
  settings: 'Settings',
};

export default function App() {
  const backendMode: BackendMode = getBackendMode();

  const [authChecking, setAuthChecking] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // User-isolated persisted entities
  const [projects, setProjects] = useState<Project[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [lyrics, setLyrics] = useState<Lyrics[]>([]);
  const [compositions, setCompositions] = useState<Composition[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);

  const loadWorkspaceData = useCallback(async (userId: string) => {
    setDataLoading(true);
    setGlobalError(null);
    try {
      const [proj, recs, anas, lyrs, comps, favs] = await Promise.all([
        dataService.listProjects(userId),
        dataService.listRecordings(userId),
        dataService.listAnalyses(userId),
        dataService.listLyrics(userId),
        dataService.listCompositions(userId),
        dataService.listFavorites(userId),
      ]);
      setProjects(proj);
      setRecordings(recs);
      setAnalyses(anas);
      setLyrics(lyrs);
      setCompositions(comps);
      setFavorites(favs);
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : 'Failed to load workspace data from storage.'
      );
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    dataService
      .getSessionUser()
      .then((sessionUser) => {
        if (!mounted) return;
        setUser(sessionUser);
        if (sessionUser) {
          loadWorkspaceData(sessionUser.id);
        }
      })
      .catch((err) => {
        if (mounted) {
          setGlobalError(err instanceof Error ? err.message : 'Failed to check session.');
        }
      })
      .finally(() => {
        if (mounted) setAuthChecking(false);
      });

    if (isSupabaseConfigured) {
      const supabase = getSupabaseClient();
      const sub = supabase?.auth.onAuthStateChange((_event, session) => {
        if (!session?.user) {
          setUser(null);
          setProjects([]);
          setRecordings([]);
          setAnalyses([]);
          setLyrics([]);
          setCompositions([]);
          setFavorites([]);
        }
      });
      return () => {
        mounted = false;
        sub?.data.subscription.unsubscribe();
      };
    }

    return () => {
      mounted = false;
    };
  }, [loadWorkspaceData]);

  const handleAuthenticated = (authedUser: User) => {
    setUser(authedUser);
    setActiveSection('dashboard');
    setSelectedRecordingId(null);
    loadWorkspaceData(authedUser.id);
  };

  const handleLogout = async () => {
    try {
      await dataService.logout();
      setUser(null);
      setProjects([]);
      setRecordings([]);
      setAnalyses([]);
      setLyrics([]);
      setCompositions([]);
      setFavorites([]);
      setSelectedRecordingId(null);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Sign out failed.');
    }
  };

  const navigateTo = (section: NavSection) => {
    setActiveSection(section);
    setSelectedRecordingId(null);
  };

  const openRecordingDetail = (recordingId: string) => {
    setSelectedRecordingId(recordingId);
  };

  const openProjectDetail = (projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedRecordingId(null);
    setActiveSection('projects');
  };

  const handleCreateRecording = async (params: {
    title: string;
    description: string;
    tags: string[];
    projectId: string | null;
    blob: Blob;
    duration: number;
    mimeType: string;
  }): Promise<Recording> => {
    if (!user) throw new Error('Not authenticated.');
    const created = await dataService.createRecording({
      userId: user.id,
      ...params,
    });
    setRecordings((prev) => [created, ...prev]);
    return created;
  };

  const handleUpdateRecording = async (recording: Recording) => {
    const updated = await dataService.updateRecording(recording);
    setRecordings((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  };

  const handleDeleteRecording = async (recording: Recording) => {
    if (!user) return;
    await dataService.deleteRecording(user.id, recording);
    setRecordings((prev) => prev.filter((r) => r.id !== recording.id));
    setAnalyses((prev) => prev.filter((a) => a.recording_id !== recording.id));
    setFavorites((prev) => prev.filter((f) => f.recording_id !== recording.id));
    if (selectedRecordingId === recording.id) {
      setSelectedRecordingId(null);
    }
  };

  const handleToggleFavorite = async (recordingId: string) => {
    if (!user) return;
    const result = await dataService.toggleFavorite(user.id, recordingId);
    if (result) {
      setFavorites((prev) => [...prev, result]);
    } else {
      setFavorites((prev) => prev.filter((f) => f.recording_id !== recordingId));
    }
  };

  const handleSaveAnalysis = async (analysis: Analysis): Promise<Analysis> => {
    const saved = await dataService.saveAnalysis(analysis);
    setAnalyses((prev) => [saved, ...prev.filter((a) => a.id !== saved.id)]);
    return saved;
  };

  const handleSaveComposition = async (composition: Composition): Promise<Composition> => {
    const saved = await dataService.saveComposition(composition);
    setCompositions((prev) => [saved, ...prev.filter((c) => c.id !== saved.id)]);
    return saved;
  };

  const handleSaveLyrics = async (item: Lyrics): Promise<Lyrics> => {
    const saved = await dataService.saveLyrics(item);
    setLyrics((prev) => [saved, ...prev.filter((l) => l.id !== saved.id)]);
    return saved;
  };

  const handleDeleteLyrics = async (lyricsId: string) => {
    if (!user) return;
    await dataService.deleteLyrics(user.id, lyricsId);
    setLyrics((prev) => prev.filter((l) => l.id !== lyricsId));
  };

  const handleSaveProject = async (project: Project): Promise<Project> => {
    const saved = await dataService.saveProject(project);
    setProjects((prev) => [saved, ...prev.filter((p) => p.id !== saved.id)]);
    return saved;
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!user) return;
    await dataService.deleteProject(user.id, projectId);
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    setRecordings((prev) =>
      prev.map((r) => (r.project_id === projectId ? { ...r, project_id: null } : r))
    );
  };

  const handleUpdateProfile = async (patch: Partial<User>): Promise<User> => {
    if (!user) throw new Error('Not authenticated.');
    const updated = await dataService.updateProfile(user.id, patch);
    setUser(updated);
    return updated;
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#0B0C10] flex items-center justify-center text-slate-300">
        <div className="flex items-center gap-2.5 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-[#8B5CF6]" />
          <span>Loading SoundScribe studio...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthGate backendMode={backendMode} onAuthenticated={handleAuthenticated} />;
  }

  const selectedRecording = selectedRecordingId
    ? recordings.find((r) => r.id === selectedRecordingId) || null
    : null;

  return (
    <div className="min-h-screen bg-[#0B0C10] text-[#F2F4F8] flex">
      <Sidebar
        activeSection={activeSection}
        onNavigate={navigateTo}
        user={user}
        backendMode={backendMode}
        counts={{
          recordings: recordings.length,
          favorites: favorites.length,
          projects: projects.length,
          lyrics: lyrics.length,
        }}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        onLogout={handleLogout}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Compact Top Header */}
        <header className="sticky top-0 z-30 h-14 px-4 sm:px-8 bg-[#0B0C10]/90 backdrop-blur-md border-b border-white/[0.06] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-300 hover:bg-white/[0.06]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium text-slate-300 truncate">
              {selectedRecording
                ? `My Ideas / ${selectedRecording.title}`
                : SECTION_TITLES[activeSection]}
            </span>
          </div>

          <button
            type="button"
            onClick={() => navigateTo('studio')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <Mic className="w-3.5 h-3.5" />
            <span>Record Idea</span>
          </button>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
          {globalError && (
            <div
              role="alert"
              className="mb-6 flex items-center justify-between gap-3 rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-xs text-rose-300"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{globalError}</span>
              </div>
              <button
                type="button"
                onClick={() => setGlobalError(null)}
                className="text-rose-200 hover:underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {dataLoading ? (
            <div className="py-20 flex items-center justify-center gap-2.5 text-sm text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin text-[#8B5CF6]" />
              <span>Loading your studio library...</span>
            </div>
          ) : selectedRecording ? (
            <RecordingDetailView
              user={user}
              recording={selectedRecording}
              projects={projects}
              analyses={analyses}
              compositions={compositions}
              isFavorite={favorites.some((f) => f.recording_id === selectedRecording.id)}
              resolveAudioUrl={(rec) => dataService.getPlaybackUrl(user.id, rec)}
              getAudioBlob={(rec) => dataService.getAudioBlob(user.id, rec)}
              onBack={() => setSelectedRecordingId(null)}
              onToggleFavorite={handleToggleFavorite}
              onUpdateRecording={handleUpdateRecording}
              onDeleteRecording={handleDeleteRecording}
              onSaveAnalysis={handleSaveAnalysis}
              onSaveComposition={handleSaveComposition}
              onSaveLyricsSheet={handleSaveLyrics}
              onOpenLyricsWorkspace={() => navigateTo('lyrics')}
            />
          ) : (
            <>
              {activeSection === 'dashboard' && (
                <DashboardView
                  user={user}
                  recordings={recordings}
                  projects={projects}
                  analyses={analyses}
                  lyrics={lyrics}
                  compositions={compositions}
                  onNavigate={navigateTo}
                  onOpenRecording={openRecordingDetail}
                  onOpenProject={openProjectDetail}
                  onSaveQuickRecording={handleCreateRecording}
                  onUploadFileToStudio={(file) => {
                    setPendingUploadFile(file);
                    navigateTo('studio');
                  }}
                />
              )}

              {activeSection === 'studio' && (
                <RecordingStudioView
                  user={user}
                  projects={projects}
                  pendingUploadFile={pendingUploadFile}
                  onClearPendingUpload={() => setPendingUploadFile(null)}
                  onSaveRecording={handleCreateRecording}
                  onOpenRecording={openRecordingDetail}
                />
              )}

              {activeSection === 'ideas' && (
                <IdeasLibraryView
                  title="My Ideas"
                  subtitle="Search, filter, audition waveforms, and open any recording for AI analysis and composition development."
                  recordings={recordings}
                  projects={projects}
                  analyses={analyses}
                  favorites={favorites}
                  resolveAudioUrl={(rec) => dataService.getPlaybackUrl(user.id, rec)}
                  onOpenRecording={openRecordingDetail}
                  onToggleFavorite={handleToggleFavorite}
                  onUpdateRecording={handleUpdateRecording}
                  onDeleteRecording={handleDeleteRecording}
                  onNavigate={navigateTo}
                />
              )}

              {activeSection === 'favorites' && (
                <IdeasLibraryView
                  title="Favorites"
                  subtitle="Your starred melodies, vocal hooks, and standout studio takes."
                  favoritesOnly
                  recordings={recordings}
                  projects={projects}
                  analyses={analyses}
                  favorites={favorites}
                  resolveAudioUrl={(rec) => dataService.getPlaybackUrl(user.id, rec)}
                  onOpenRecording={openRecordingDetail}
                  onToggleFavorite={handleToggleFavorite}
                  onUpdateRecording={handleUpdateRecording}
                  onDeleteRecording={handleDeleteRecording}
                  onNavigate={navigateTo}
                />
              )}

              {activeSection === 'lyrics' && (
                <LyricsWorkspaceView
                  user={user}
                  lyricsList={lyrics}
                  projects={projects}
                  recordings={recordings}
                  onSaveLyrics={handleSaveLyrics}
                  onDeleteLyrics={handleDeleteLyrics}
                />
              )}

              {activeSection === 'projects' && (
                <ProjectsView
                  user={user}
                  projects={projects}
                  recordings={recordings}
                  lyrics={lyrics}
                  compositions={compositions}
                  initialSelectedProjectId={selectedProjectId}
                  onSaveProject={handleSaveProject}
                  onDeleteProject={handleDeleteProject}
                  onAssignRecording={(rec, projId) =>
                    handleUpdateRecording({ ...rec, project_id: projId })
                  }
                  onOpenRecording={openRecordingDetail}
                  onNavigate={navigateTo}
                />
              )}

              {activeSection === 'assistant' && (
                <AssistantView
                  recordings={recordings}
                  analyses={analyses}
                  projects={projects}
                  lyrics={lyrics}
                />
              )}

              {activeSection === 'settings' && (
                <SettingsView
                  user={user}
                  backendMode={backendMode}
                  onUpdateProfile={handleUpdateProfile}
                  onLogout={handleLogout}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
