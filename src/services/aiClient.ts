import { AnalysisEngine, AnalysisMode, StructuredAudioAnalysis } from '../types/soundscribe';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { getExtensionFromMimeType, validateAudioBlobForAnalysis } from './audioEngine';

export type AnalysisPipelineStage =
  | 'uploading'
  | 'validating'
  | 'processing'
  | 'analyzing'
  | 'extracting'
  | 'saving';

export interface AnalysisProgressUpdate {
  stage: AnalysisPipelineStage;
  detail: string;
  uploadedBytes?: number;
  totalBytes?: number;
}

export interface ServerHealthResponse {
  ok: boolean;
  geminiConfigured: boolean;
  groqConfigured: boolean;
  groqModel?: string;
  groqModelStatus?: {
    model: string;
    usable: boolean;
    deprecated: boolean;
    status: 'active' | 'deprecated' | 'unknown';
    tier: 'free' | 'developer';
    details: string;
    rateLimits: {
      rpm: number;
      rpd: number;
      audioSecondsPerHour?: number;
      audioSecondsPerDay?: number;
      maxFileSizeMb: number;
    };
  };
  supabaseConfigured: boolean;
}

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

export async function checkServerHealth(): Promise<ServerHealthResponse> {
  const res = await fetch('/api/health');
  if (!res.ok) {
    throw new Error('Unable to reach SoundScribe server.');
  }
  return res.json();
}

export async function requestAudioAnalysis(params: {
  audioBlob: Blob;
  mimeType: string;
  analysisMode?: AnalysisMode;
  engine?: AnalysisEngine;
  title?: string;
  notes?: string;
  duration?: number;
  onProgress?: (update: AnalysisProgressUpdate) => void;
}): Promise<StructuredAudioAnalysis> {
  validateAudioBlobForAnalysis(params.audioBlob, params.mimeType);

  const form = new FormData();
  const effectiveMime = params.audioBlob.type || params.mimeType || 'audio/webm';
  const ext = getExtensionFromMimeType(effectiveMime);
  form.append('audio', params.audioBlob, `recording.${ext}`);
  form.append('mimeType', effectiveMime);
  form.append('analysisMode', params.analysisMode || 'auto');
  if (params.engine) form.append('engine', params.engine);
  if (params.title) form.append('title', params.title);
  if (params.notes) form.append('notes', params.notes);
  if (typeof params.duration === 'number') form.append('duration', String(params.duration));

  const headers = await getAuthHeader();

  params.onProgress?.({
    stage: 'uploading',
    detail: `Preparing ${(params.audioBlob.size / 1024).toFixed(0)} KB audio upload...`,
    uploadedBytes: 0,
    totalBytes: params.audioBlob.size,
  });

  return new Promise<StructuredAudioAnalysis>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/ai/analyze-recording?stream=1', true);
    xhr.timeout = 95000;

    for (const [key, val] of Object.entries(headers)) {
      xhr.setRequestHeader(key, val);
    }

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) {
        const kbDone = (ev.loaded / 1024).toFixed(0);
        const kbTotal = (ev.total / 1024).toFixed(0);
        params.onProgress?.({
          stage: 'uploading',
          detail:
            ev.loaded >= ev.total
              ? `Uploaded ${kbTotal} KB. Handing off to validation...`
              : `Uploading audio (${kbDone} KB / ${kbTotal} KB)...`,
          uploadedBytes: ev.loaded,
          totalBytes: ev.total,
        });
      }
    };

    let processedLen = 0;
    let bufferRemainder = '';
    let resolvedResult: StructuredAudioAnalysis | null = null;
    let streamError: string | null = null;

    const parseNdjsonLines = (chunkText: string, flush = false) => {
      bufferRemainder += chunkText;
      const lines = bufferRemainder.split('\n');
      bufferRemainder = flush ? '' : lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as {
            type?: string;
            stage?: AnalysisPipelineStage;
            detail?: string;
            analysis?: StructuredAudioAnalysis;
            error?: string;
          };
          if (event.type === 'stage' && event.stage) {
            params.onProgress?.({
              stage: event.stage,
              detail: event.detail || '',
            });
          } else if (event.type === 'result' && event.analysis) {
            resolvedResult = event.analysis;
          } else if (event.type === 'error' && event.error) {
            streamError = event.error;
          }
        } catch {
          // Ignore partial or non-JSON line
        }
      }
    };

    xhr.onprogress = () => {
      const fullText = xhr.responseText || '';
      if (fullText.length > processedLen) {
        const delta = fullText.slice(processedLen);
        processedLen = fullText.length;
        parseNdjsonLines(delta, false);
      }
    };

    xhr.onload = () => {
      const fullText = xhr.responseText || '';
      if (fullText.length > processedLen) {
        parseNdjsonLines(fullText.slice(processedLen), true);
      } else if (bufferRemainder.trim()) {
        parseNdjsonLines('', true);
      }

      if (streamError) {
        reject(new Error(streamError));
        return;
      }

      if (resolvedResult) {
        resolve(resolvedResult);
        return;
      }

      // Fallback if server returned single JSON error/result instead of NDJSON
      try {
        const payload = JSON.parse(fullText) as {
          analysis?: StructuredAudioAnalysis;
          error?: string;
        };
        if (xhr.status >= 200 && xhr.status < 300 && payload.analysis) {
          resolve(payload.analysis);
          return;
        }
        reject(new Error(payload.error || `Audio analysis failed (${xhr.status}).`));
      } catch {
        reject(new Error(`Audio analysis failed with HTTP ${xhr.status}.`));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error while uploading audio for analysis. Check your connection and retry.'));
    };

    xhr.ontimeout = () => {
      reject(new Error('Audio analysis request timed out. Please retry with a shorter clip or retry in a moment.'));
    };

    xhr.send(form);
  });
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
