import {
  Analysis,
  BackendMode,
  Composition,
  Favorite,
  Lyrics,
  Project,
  Recording,
  User,
} from '../types/hummit';
import { getExtensionFromMimeType } from './audioEngine';
import { localDb } from './localDb';
import { getSupabaseClient, isSupabaseConfigured, ensureSupabaseConfig } from './supabaseClient';

export const GUEST_USER_PREFIX = 'guest_';
export const GUEST_SESSION_KEY = 'hummit_guest_user';
export const LEGACY_GUEST_SESSION_KEY = 'soundscribe_guest_user';

export function isGuestUser(userId?: string): boolean {
  if (typeof window === 'undefined') return false;
  if (userId && userId.startsWith(GUEST_USER_PREFIX)) return true;
  return Boolean(
    localStorage.getItem(GUEST_SESSION_KEY) || localStorage.getItem(LEGACY_GUEST_SESSION_KEY)
  );
}

function shouldUseSupabase(userId?: string): boolean {
  if (!isSupabaseConfigured) return false;
  if (!userId) return false;
  return !isGuestUser(userId);
}

export function getBackendMode(): BackendMode {
  if (isGuestUser()) return 'local';
  return isSupabaseConfigured ? 'supabase' : 'local';
}

function defaultUserFromSupabase(authUser: {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  created_at?: string;
}): User {
  return {
    id: authUser.id,
    display_name:
      (authUser.user_metadata?.display_name as string) ||
      authUser.email?.split('@')[0] ||
      'Musician',
    email: authUser.email || '',
    avatar_url: null,
    audio_preferences: {
      defaultFormat: 'audio/webm',
      autoSaveDrafts: true,
      waveformDensity: 'standard',
    },
    ai_preferences: {
      creativeFocus: 'songwriting',
      conservatism: 'balanced',
    },
    created_at: authUser.created_at || new Date().toISOString(),
  };
}

export const dataService = {
  // ---------------- AUTHENTICATION ----------------
  async getSessionUser(): Promise<User | null> {
    await ensureSupabaseConfig();
    if (typeof window !== 'undefined') {
      const guestJson =
        localStorage.getItem(GUEST_SESSION_KEY) || localStorage.getItem(LEGACY_GUEST_SESSION_KEY);
      if (guestJson) {
        try {
          const parsed = JSON.parse(guestJson) as User;
          if (parsed && parsed.id) return parsed;
        } catch {
          localStorage.removeItem(GUEST_SESSION_KEY);
          localStorage.removeItem(LEGACY_GUEST_SESSION_KEY);
        }
      }
    }

    if (isSupabaseConfigured) {
      const supabase = getSupabaseClient()!;
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();
      if (error || !session?.user) return null;

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      if (profile) {
        return {
          id: profile.id,
          display_name: profile.display_name,
          email: profile.email,
          avatar_url: profile.avatar_url,
          audio_preferences: profile.audio_preferences || {
            defaultFormat: 'audio/webm',
            autoSaveDrafts: true,
            waveformDensity: 'standard',
          },
          ai_preferences: profile.ai_preferences || {
            creativeFocus: 'songwriting',
            conservatism: 'balanced',
          },
          created_at: profile.created_at,
        };
      }
      return defaultUserFromSupabase(session.user);
    }
    return localDb.getSessionUser();
  },

  async continueAsGuest(): Promise<User> {
    if (typeof window !== 'undefined') {
      const existing = localStorage.getItem(GUEST_SESSION_KEY);
      if (existing) {
        try {
          const parsed = JSON.parse(existing) as User;
          if (parsed && parsed.id) return parsed;
        } catch {
          // ignore
        }
      }
    }

    const guestId = `${GUEST_USER_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
    const guestUser: User = {
      id: guestId,
      display_name: 'Guest Musician',
      email: 'guest@hummit.local',
      avatar_url: null,
      audio_preferences: {
        defaultFormat: 'audio/webm',
        autoSaveDrafts: true,
        waveformDensity: 'standard',
      },
      ai_preferences: {
        creativeFocus: 'songwriting',
        conservatism: 'balanced',
      },
      created_at: new Date().toISOString(),
    };

    if (typeof window !== 'undefined') {
      localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(guestUser));
    }
    await localDb.saveGuestUser(guestUser);
    return guestUser;
  },

  async register(email: string, password: string, displayName: string): Promise<User> {
    await ensureSupabaseConfig();
    if (typeof window !== 'undefined') {
      localStorage.removeItem(GUEST_SESSION_KEY);
    }
    if (isSupabaseConfigured) {
      const supabase = getSupabaseClient()!;
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: displayName.trim() || email.split('@')[0] },
        },
      });
      if (error) throw new Error(error.message);
      if (!data.user) {
        throw new Error('Registration succeeded, please verify your email to continue.');
      }
      if (!data.session) {
        throw new Error(
          'Account created! Check your inbox to confirm your email address before signing in.'
        );
      }
      return (await this.getSessionUser()) || defaultUserFromSupabase(data.user);
    }
    return localDb.register(email, password, displayName);
  },

  async login(email: string, password: string): Promise<User> {
    await ensureSupabaseConfig();
    if (typeof window !== 'undefined') {
      localStorage.removeItem(GUEST_SESSION_KEY);
    }
    if (isSupabaseConfigured) {
      const supabase = getSupabaseClient()!;
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw new Error(error.message);
      if (!data.user) throw new Error('Unable to sign in.');
      return (await this.getSessionUser()) || defaultUserFromSupabase(data.user);
    }
    return localDb.login(email, password);
  },

  async logout(): Promise<void> {
    await ensureSupabaseConfig();
    if (typeof window !== 'undefined') {
      localStorage.removeItem(GUEST_SESSION_KEY);
    }
    if (isSupabaseConfigured) {
      const supabase = getSupabaseClient();
      if (supabase) {
        try {
          await supabase.auth.signOut();
        } catch {
          // ignore
        }
      }
    }
    await localDb.logout();
  },

  async updateProfile(userId: string, patch: Partial<User>): Promise<User> {
    if (isGuestUser(userId)) {
      const guestJson = typeof window !== 'undefined' ? localStorage.getItem(GUEST_SESSION_KEY) : null;
      const current = guestJson ? (JSON.parse(guestJson) as User) : null;
      const updated: User = {
        ...(current || {
          id: userId,
          display_name: 'Guest Musician',
          email: 'guest@hummit.local',
          avatar_url: null,
          audio_preferences: {
            defaultFormat: 'audio/webm',
            autoSaveDrafts: true,
            waveformDensity: 'standard',
          },
          ai_preferences: {
            creativeFocus: 'songwriting',
            conservatism: 'balanced',
          },
          created_at: new Date().toISOString(),
        }),
        ...patch,
      };
      if (typeof window !== 'undefined') {
        localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(updated));
      }
      await localDb.saveGuestUser(updated);
      return updated;
    }

    if (shouldUseSupabase(userId)) {
      const supabase = getSupabaseClient()!;
      const { data, error } = await supabase
        .from('profiles')
        .update({
          display_name: patch.display_name,
          avatar_url: patch.avatar_url,
          audio_preferences: patch.audio_preferences,
          ai_preferences: patch.ai_preferences,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as User;
    }
    return localDb.updateProfile(userId, patch);
  },

  // ---------------- PROJECTS ----------------
  async listProjects(userId: string): Promise<Project[]> {
    if (shouldUseSupabase(userId)) {
      const supabase = getSupabaseClient()!;
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []) as Project[];
    }
    return localDb.listProjects(userId);
  },

  async saveProject(project: Project): Promise<Project> {
    if (shouldUseSupabase(project.user_id)) {
      const supabase = getSupabaseClient()!;
      const { data, error } = await supabase
        .from('projects')
        .upsert(project, { onConflict: 'id' })
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as Project;
    }
    return localDb.saveProject(project);
  },

  async deleteProject(userId: string, projectId: string): Promise<void> {
    if (shouldUseSupabase(userId)) {
      const supabase = getSupabaseClient()!;
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      return;
    }
    await localDb.deleteProject(userId, projectId);
  },

  // ---------------- RECORDINGS & PRIVATE AUDIO STORAGE ----------------
  async listRecordings(userId: string): Promise<Recording[]> {
    if (shouldUseSupabase(userId)) {
      const supabase = getSupabaseClient()!;
      const { data, error } = await supabase
        .from('recordings')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []) as Recording[];
    }
    return localDb.listRecordings(userId);
  },

  async createRecording(params: {
    userId: string;
    title: string;
    description: string;
    tags: string[];
    projectId: string | null;
    blob: Blob;
    duration: number;
    mimeType: string;
  }): Promise<Recording> {
    const id = crypto.randomUUID();
    const ext = getExtensionFromMimeType(params.mimeType);
    const storagePath = `${params.userId}/${id}.${ext}`;
    const now = new Date().toISOString();

    const recording: Recording = {
      id,
      user_id: params.userId,
      project_id: params.projectId,
      title: params.title.trim() || 'Untitled Musical Idea',
      description: params.description.trim(),
      tags: params.tags,
      storage_path: storagePath,
      duration: Number(params.duration.toFixed(2)),
      mime_type: params.mimeType,
      file_size: params.blob.size,
      status: 'draft',
      created_at: now,
      updated_at: now,
    };

    if (shouldUseSupabase(params.userId)) {
      const supabase = getSupabaseClient()!;
      const { error: uploadError } = await supabase.storage
        .from('recordings')
        .upload(storagePath, params.blob, {
          contentType: params.mimeType,
          upsert: false,
        });
      if (uploadError) {
        if (uploadError.message.includes('Bucket not found') || uploadError.message.toLowerCase().includes('bucket')) {
          throw new Error(
            "Storage upload failed: Bucket 'recordings' not found. In your Supabase Dashboard, go to Storage > click 'New bucket' > name it 'recordings' (lowercase, private) and save."
          );
        }
        throw new Error(`Storage upload failed: ${uploadError.message}`);
      }

      const { data, error: insertError } = await supabase
        .from('recordings')
        .insert({
          id: recording.id,
          user_id: recording.user_id,
          project_id: recording.project_id,
          title: recording.title,
          description: recording.description,
          tags: recording.tags,
          storage_path: recording.storage_path,
          duration: recording.duration,
          mime_type: recording.mime_type,
          file_size: recording.file_size,
          status: recording.status,
          created_at: recording.created_at,
          updated_at: recording.updated_at,
        })
        .select('*')
        .single();

      if (insertError) {
        // Roll back uploaded storage object if DB insert fails
        await supabase.storage.from('recordings').remove([storagePath]);
        throw new Error(`Database save failed: ${insertError.message}`);
      }
      return data as Recording;
    }

    return localDb.saveRecording(recording, params.blob);
  },

  async updateRecording(recording: Recording): Promise<Recording> {
    const updated: Recording = {
      ...recording,
      updated_at: new Date().toISOString(),
    };
    if (shouldUseSupabase(recording.user_id)) {
      const supabase = getSupabaseClient()!;
      const { data, error } = await supabase
        .from('recordings')
        .update({
          title: updated.title,
          description: updated.description,
          tags: updated.tags,
          project_id: updated.project_id,
          status: updated.status,
          updated_at: updated.updated_at,
        })
        .eq('id', updated.id)
        .eq('user_id', updated.user_id)
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as Recording;
    }
    return localDb.saveRecording(updated);
  },

  async deleteRecording(userId: string, recording: Recording): Promise<void> {
    if (shouldUseSupabase(userId)) {
      const supabase = getSupabaseClient()!;
      const { error } = await supabase
        .from('recordings')
        .delete()
        .eq('id', recording.id)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      await supabase.storage.from('recordings').remove([recording.storage_path]);
      return;
    }
    await localDb.deleteRecording(userId, recording.id);
  },

  async getPlaybackUrl(userId: string, recording: Recording): Promise<string> {
    if (shouldUseSupabase(userId)) {
      const supabase = getSupabaseClient()!;
      const { data, error } = await supabase.storage
        .from('recordings')
        .createSignedUrl(recording.storage_path, 3600);
      if (error || !data?.signedUrl) {
        throw new Error(error?.message || 'Unable to create signed playback URL.');
      }
      return data.signedUrl;
    }
    const blob = await localDb.getAudioBlob(userId, recording.storage_path);
    if (!blob) {
      throw new Error('Audio data could not be found in local storage.');
    }
    return URL.createObjectURL(blob);
  },

  async getAudioBlob(userId: string, recording: Recording): Promise<Blob> {
    if (shouldUseSupabase(userId)) {
      const supabase = getSupabaseClient()!;
      const { data, error } = await supabase.storage
        .from('recordings')
        .download(recording.storage_path);
      if (error || !data) {
        throw new Error(error?.message || 'Unable to fetch recording audio from storage.');
      }
      return data;
    }
    const blob = await localDb.getAudioBlob(userId, recording.storage_path);
    if (!blob) {
      throw new Error('Audio blob missing from local IndexedDB storage.');
    }
    return blob;
  },

  // ---------------- ANALYSES ----------------
  async listAnalyses(userId: string): Promise<Analysis[]> {
    if (shouldUseSupabase(userId)) {
      const supabase = getSupabaseClient()!;
      const { data, error } = await supabase
        .from('analyses')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []) as Analysis[];
    }
    return localDb.listAnalyses(userId);
  },

  async saveAnalysis(analysis: Analysis): Promise<Analysis> {
    if (shouldUseSupabase(analysis.user_id)) {
      const supabase = getSupabaseClient()!;
      const { data, error } = await supabase
        .from('analyses')
        .upsert(analysis, { onConflict: 'id' })
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as Analysis;
    }
    return localDb.saveAnalysis(analysis);
  },

  // ---------------- LYRICS ----------------
  async listLyrics(userId: string): Promise<Lyrics[]> {
    if (shouldUseSupabase(userId)) {
      const supabase = getSupabaseClient()!;
      const { data, error } = await supabase
        .from('lyrics')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []) as Lyrics[];
    }
    return localDb.listLyrics(userId);
  },

  async saveLyrics(lyrics: Lyrics): Promise<Lyrics> {
    if (shouldUseSupabase(lyrics.user_id)) {
      const supabase = getSupabaseClient()!;
      const { data, error } = await supabase
        .from('lyrics')
        .upsert(lyrics, { onConflict: 'id' })
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as Lyrics;
    }
    return localDb.saveLyrics(lyrics);
  },

  async deleteLyrics(userId: string, lyricsId: string): Promise<void> {
    if (shouldUseSupabase(userId)) {
      const supabase = getSupabaseClient()!;
      const { error } = await supabase
        .from('lyrics')
        .delete()
        .eq('id', lyricsId)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      return;
    }
    await localDb.deleteLyrics(userId, lyricsId);
  },

  // ---------------- COMPOSITIONS ----------------
  async listCompositions(userId: string): Promise<Composition[]> {
    if (shouldUseSupabase(userId)) {
      const supabase = getSupabaseClient()!;
      const { data, error } = await supabase
        .from('compositions')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []) as Composition[];
    }
    return localDb.listCompositions(userId);
  },

  async saveComposition(composition: Composition): Promise<Composition> {
    if (shouldUseSupabase(composition.user_id)) {
      const supabase = getSupabaseClient()!;
      const { data, error } = await supabase
        .from('compositions')
        .upsert(composition, { onConflict: 'id' })
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as Composition;
    }
    return localDb.saveComposition(composition);
  },

  async deleteComposition(userId: string, compositionId: string): Promise<void> {
    if (shouldUseSupabase(userId)) {
      const supabase = getSupabaseClient()!;
      const { error } = await supabase
        .from('compositions')
        .delete()
        .eq('id', compositionId)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      return;
    }
    await localDb.deleteComposition(userId, compositionId);
  },

  // ---------------- FAVORITES ----------------
  async listFavorites(userId: string): Promise<Favorite[]> {
    if (shouldUseSupabase(userId)) {
      const supabase = getSupabaseClient()!;
      const { data, error } = await supabase
        .from('favorites')
        .select('*')
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      return (data || []) as Favorite[];
    }
    return localDb.listFavorites(userId);
  },

  async toggleFavorite(userId: string, recordingId: string): Promise<Favorite | null> {
    if (shouldUseSupabase(userId)) {
      const supabase = getSupabaseClient()!;
      const { data: existing } = await supabase
        .from('favorites')
        .select('*')
        .eq('user_id', userId)
        .eq('recording_id', recordingId)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('favorites')
          .delete()
          .eq('id', existing.id)
          .eq('user_id', userId);
        if (error) throw new Error(error.message);
        return null;
      }

      const { data, error } = await supabase
        .from('favorites')
        .insert({
          id: crypto.randomUUID(),
          user_id: userId,
          recording_id: recordingId,
          created_at: new Date().toISOString(),
        })
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data as Favorite;
    }
    return localDb.toggleFavorite(userId, recordingId);
  },
};
