import {
  Analysis,
  Composition,
  Favorite,
  Lyrics,
  Project,
  Recording,
  User,
} from '../types/hummit';

const DB_NAME = 'hummit_local_v1';
const DB_VERSION = 1;
const SESSION_KEY = 'hummit_local_session_user_id';
const LEGACY_SESSION_KEY = 'soundscribe_local_session_user_id';

interface LocalAuthRecord {
  id: string;
  email: string;
  passwordHash: string;
  user: User;
}

interface AudioBlobRecord {
  storage_path: string;
  user_id: string;
  blob: Blob;
  mime_type: string;
  created_at: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('users')) {
        const userStore = db.createObjectStore('users', { keyPath: 'id' });
        userStore.createIndex('email', 'email', { unique: true });
      }
      if (!db.objectStoreNames.contains('projects')) {
        const store = db.createObjectStore('projects', { keyPath: 'id' });
        store.createIndex('user_id', 'user_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('recordings')) {
        const store = db.createObjectStore('recordings', { keyPath: 'id' });
        store.createIndex('user_id', 'user_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('audio_blobs')) {
        const store = db.createObjectStore('audio_blobs', { keyPath: 'storage_path' });
        store.createIndex('user_id', 'user_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('analyses')) {
        const store = db.createObjectStore('analyses', { keyPath: 'id' });
        store.createIndex('user_id', 'user_id', { unique: false });
        store.createIndex('recording_id', 'recording_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('lyrics')) {
        const store = db.createObjectStore('lyrics', { keyPath: 'id' });
        store.createIndex('user_id', 'user_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('compositions')) {
        const store = db.createObjectStore('compositions', { keyPath: 'id' });
        store.createIndex('user_id', 'user_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('favorites')) {
        const store = db.createObjectStore('favorites', { keyPath: 'id' });
        store.createIndex('user_id', 'user_id', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB.'));
  });
}

async function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAllByUser<T>(storeName: string, userId: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const index = tx.objectStore(storeName).index('user_id');
    const req = index.getAll(userId);
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => reject(req.error);
  });
}

async function hashPassword(password: string, email: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${email.toLowerCase().trim()}::${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const localDb = {
  async register(email: string, password: string, displayName: string): Promise<User> {
    const normalizedEmail = email.toLowerCase().trim();
    const db = await openDb();

    const existing = await new Promise<LocalAuthRecord | undefined>((resolve, reject) => {
      const tx = db.transaction('users', 'readonly');
      const idx = tx.objectStore('users').index('email');
      const req = idx.get(normalizedEmail);
      req.onsuccess = () => resolve(req.result as LocalAuthRecord | undefined);
      req.onerror = () => reject(req.error);
    });

    if (existing) {
      throw new Error('An account with this email already exists in local storage.');
    }

    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    const user: User = {
      id: userId,
      display_name: displayName.trim() || normalizedEmail.split('@')[0],
      email: normalizedEmail,
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
      created_at: now,
    };

    const passwordHash = await hashPassword(password, normalizedEmail);
    await idbPut<LocalAuthRecord>('users', {
      id: userId,
      email: normalizedEmail,
      passwordHash,
      user,
    });

    localStorage.setItem(SESSION_KEY, userId);
    return user;
  },

  async login(email: string, password: string): Promise<User> {
    const normalizedEmail = email.toLowerCase().trim();
    const db = await openDb();
    const record = await new Promise<LocalAuthRecord | undefined>((resolve, reject) => {
      const tx = db.transaction('users', 'readonly');
      const idx = tx.objectStore('users').index('email');
      const req = idx.get(normalizedEmail);
      req.onsuccess = () => resolve(req.result as LocalAuthRecord | undefined);
      req.onerror = () => reject(req.error);
    });

    if (!record) {
      throw new Error('Invalid email or password.');
    }

    const hash = await hashPassword(password, normalizedEmail);
    if (hash !== record.passwordHash) {
      throw new Error('Invalid email or password.');
    }

    localStorage.setItem(SESSION_KEY, record.id);
    return record.user;
  },

  async logout(): Promise<void> {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_SESSION_KEY);
  },

  async getSessionUser(): Promise<User | null> {
    const userId =
      localStorage.getItem(SESSION_KEY) || localStorage.getItem(LEGACY_SESSION_KEY);
    if (!userId) return null;
    const record = await idbGet<LocalAuthRecord>('users', userId);
    return record?.user ?? null;
  },

  async updateProfile(userId: string, patch: Partial<User>): Promise<User> {
    const record = await idbGet<LocalAuthRecord>('users', userId);
    if (!record) {
      const updated: User = {
        id: userId,
        display_name: patch.display_name || 'Guest Musician',
        email: 'guest@hummit.local',
        avatar_url: patch.avatar_url || null,
        audio_preferences: patch.audio_preferences || {
          defaultFormat: 'audio/webm',
          autoSaveDrafts: true,
          waveformDensity: 'standard',
        },
        ai_preferences: patch.ai_preferences || {
          creativeFocus: 'songwriting',
          conservatism: 'balanced',
        },
        created_at: new Date().toISOString(),
      };
      await this.saveGuestUser(updated);
      return updated;
    }
    const updated: User = {
      ...record.user,
      ...patch,
      id: record.user.id,
      email: record.user.email,
    };
    await idbPut<LocalAuthRecord>('users', { ...record, user: updated });
    return updated;
  },

  async saveGuestUser(user: User): Promise<void> {
    await idbPut<LocalAuthRecord>('users', {
      id: user.id,
      email: user.email,
      passwordHash: '',
      user,
    });
  },

  // Projects
  async listProjects(userId: string): Promise<Project[]> {
    const items = await idbGetAllByUser<Project>('projects', userId);
    return items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  },
  async saveProject(project: Project): Promise<Project> {
    await idbPut('projects', project);
    return project;
  },
  async deleteProject(userId: string, projectId: string): Promise<void> {
    const existing = await idbGet<Project>('projects', projectId);
    if (!existing || existing.user_id !== userId) {
      throw new Error('Project not found or unauthorized.');
    }
    await idbDelete('projects', projectId);
  },

  // Recordings + Blobs
  async listRecordings(userId: string): Promise<Recording[]> {
    const items = await idbGetAllByUser<Recording>('recordings', userId);
    return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  async saveRecording(recording: Recording, blob?: Blob): Promise<Recording> {
    if (blob) {
      await idbPut<AudioBlobRecord>('audio_blobs', {
        storage_path: recording.storage_path,
        user_id: recording.user_id,
        blob,
        mime_type: recording.mime_type,
        created_at: recording.created_at,
      });
    }
    await idbPut('recordings', recording);
    return recording;
  },
  async getAudioBlob(userId: string, storagePath: string): Promise<Blob | null> {
    const record = await idbGet<AudioBlobRecord>('audio_blobs', storagePath);
    if (!record || record.user_id !== userId) return null;
    return record.blob;
  },
  async deleteRecording(userId: string, recordingId: string): Promise<void> {
    const existing = await idbGet<Recording>('recordings', recordingId);
    if (!existing || existing.user_id !== userId) {
      throw new Error('Recording not found or unauthorized.');
    }
    await idbDelete('recordings', recordingId);
    await idbDelete('audio_blobs', existing.storage_path);
    const analyses = await idbGetAllByUser<Analysis>('analyses', userId);
    for (const a of analyses) {
      if (a.recording_id === recordingId) await idbDelete('analyses', a.id);
    }
    const favs = await idbGetAllByUser<Favorite>('favorites', userId);
    for (const f of favs) {
      if (f.recording_id === recordingId) await idbDelete('favorites', f.id);
    }
  },

  // Analyses
  async listAnalyses(userId: string): Promise<Analysis[]> {
    const items = await idbGetAllByUser<Analysis>('analyses', userId);
    return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  async saveAnalysis(analysis: Analysis): Promise<Analysis> {
    await idbPut('analyses', analysis);
    return analysis;
  },

  // Lyrics
  async listLyrics(userId: string): Promise<Lyrics[]> {
    const items = await idbGetAllByUser<Lyrics>('lyrics', userId);
    return items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  },
  async saveLyrics(lyrics: Lyrics): Promise<Lyrics> {
    await idbPut('lyrics', lyrics);
    return lyrics;
  },
  async deleteLyrics(userId: string, lyricsId: string): Promise<void> {
    const existing = await idbGet<Lyrics>('lyrics', lyricsId);
    if (!existing || existing.user_id !== userId) {
      throw new Error('Lyrics document not found or unauthorized.');
    }
    await idbDelete('lyrics', lyricsId);
  },

  // Compositions
  async listCompositions(userId: string): Promise<Composition[]> {
    const items = await idbGetAllByUser<Composition>('compositions', userId);
    return items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  },
  async saveComposition(composition: Composition): Promise<Composition> {
    await idbPut('compositions', composition);
    return composition;
  },
  async deleteComposition(userId: string, compositionId: string): Promise<void> {
    const existing = await idbGet<Composition>('compositions', compositionId);
    if (!existing || existing.user_id !== userId) {
      throw new Error('Composition not found or unauthorized.');
    }
    await idbDelete('compositions', compositionId);
  },

  // Favorites
  async listFavorites(userId: string): Promise<Favorite[]> {
    return idbGetAllByUser<Favorite>('favorites', userId);
  },
  async toggleFavorite(userId: string, recordingId: string): Promise<Favorite | null> {
    const favs = await idbGetAllByUser<Favorite>('favorites', userId);
    const existing = favs.find((f) => f.recording_id === recordingId);
    if (existing) {
      await idbDelete('favorites', existing.id);
      return null;
    }
    const created: Favorite = {
      id: crypto.randomUUID(),
      user_id: userId,
      recording_id: recordingId,
      created_at: new Date().toISOString(),
    };
    await idbPut('favorites', created);
    return created;
  },
};
