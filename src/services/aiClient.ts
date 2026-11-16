import { StructuredAudioAnalysis } from '../types/soundscribe';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { getExtensionFromMimeType } from './audioEngine';

async function getAuthHeader(): Promise<Record<string, string>> {
  if (isSupabaseConfigured) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        return { Authorization: `Bearer ${token}` };
      }
    }
  }
  return { Authorization: 'Bearer local-session' };
}

export async function checkServerHealth(): Promise<{
  ok: boolean;
  geminiConfigured: boolean;
  supabaseConfigured: boolean;
}> {
  const res = await fetch('/api/health');
  if (!res.ok) {
    throw new Error('Unable to reach SoundScribe server.');
  }
  return res.json();
}

export async function requestAudioAnalysis(params: {
  audioBlob: Blob;
  mimeType: string;
  title?: string;
  notes?: string;
  duration?: number;
}): Promise<StructuredAudioAnalysis> {
  const form = new FormData();
  const ext = getExtensionFromMimeType(params.mimeType);
  form.append('audio', params.audioBlob, `recording.${ext}`);
  form.append('mimeType', params.mimeType);
  if (params.title) form.append('title', params.title);
  if (params.notes) form.append('notes', params.notes);
  if (typeof params.duration === 'number') form.append('duration', String(params.duration));

  const headers = await getAuthHeader();
  const res = await fetch('/api/ai/analyze-recording', {
    method: 'POST',
    headers,
    body: form,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error || `Audio analysis failed (${res.status}).`);
  }
  return payload.analysis as StructuredAudioAnalysis;
}

export interface DevelopedIdeaPlan {
  suggested_title: string;
  creative_concept: string;
  song_description: string;
  structure: Array<{
    name: string;
    purpose: string;
    energy_notes: string;
    lyric_focus: string;
  }>;
  chord_suggestions: Array<{
    section_name: string;
    chords: string;
    harmonic_feel: string;
  }>;
  instrument_suggestions: string[];
  arrangement_notes: string;
  tempo_recommendations: string;
  vocal_performance_suggestions: string;
  next_creative_steps: string[];
}

export async function requestDevelopIdea(params: {
  audioBlob?: Blob | null;
  mimeType?: string;
  title: string;
  notes?: string;
  transcript?: string;
  lyrics?: string;
  mood?: string[];
  genre?: string[];
  analysisSummary?: string;
  creativeFocus?: string;
}): Promise<DevelopedIdeaPlan> {
  const form = new FormData();
  if (params.audioBlob && params.mimeType) {
    const ext = getExtensionFromMimeType(params.mimeType);
    form.append('audio', params.audioBlob, `recording.${ext}`);
    form.append('mimeType', params.mimeType);
  }
  form.append('title', params.title);
  if (params.notes) form.append('notes', params.notes);
  if (params.transcript) form.append('transcript', params.transcript);
  if (params.lyrics) form.append('lyrics', params.lyrics);
  if (params.mood?.length) form.append('mood', JSON.stringify(params.mood));
  if (params.genre?.length) form.append('genre', JSON.stringify(params.genre));
  if (params.analysisSummary) form.append('analysisSummary', params.analysisSummary);
  if (params.creativeFocus) form.append('creativeFocus', params.creativeFocus);

  const headers = await getAuthHeader();
  const res = await fetch('/api/ai/develop-idea', {
    method: 'POST',
    headers,
    body: form,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error || `Composition development failed (${res.status}).`);
  }
  return payload.plan as DevelopedIdeaPlan;
}

export async function requestLyricAssist(params: {
  action: 'continue' | 'rewrite' | 'chorus' | 'rhymes' | 'tone';
  title: string;
  currentLyrics: string;
  selectedText?: string;
  targetTone?: string;
  mood?: string;
  genre?: string;
}): Promise<Array<{ label: string; text: string; rationale: string }>> {
  const headers = await getAuthHeader();
  const res = await fetch('/api/ai/lyric-assist', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(params),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error || `Lyric assistant request failed (${res.status}).`);
  }
  return payload.suggestions || [];
}

export async function requestAssistantChat(params: {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  contextSummary?: string;
}): Promise<string> {
  const headers = await getAuthHeader();
  const res = await fetch('/api/ai/assistant', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(params),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error || `Assistant request failed (${res.status}).`);
  }
  return payload.reply as string;
}
