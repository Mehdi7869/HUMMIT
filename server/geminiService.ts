import { GoogleGenAI, Type } from '@google/genai';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add your Gemini API key in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractFriendlyGeminiError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw);
    const code = parsed?.error?.code;
    const msg = parsed?.error?.message;
    if (code === 503 || parsed?.error?.status === 'UNAVAILABLE') {
      return new Error(
        'Gemini AI is temporarily experiencing high demand (503). Please click Retry in a few seconds.'
      );
    }
    if (code === 429 || parsed?.error?.status === 'RESOURCE_EXHAUSTED') {
      return new Error(
        'Gemini API rate limit reached (429). Please wait a moment and try again.'
      );
    }
    if (typeof msg === 'string' && msg) {
      return new Error(msg);
    }
  } catch {
    // Not JSON
  }
  return err instanceof Error ? err : new Error(raw);
}

async function withGeminiRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED');
      if (!isTransient || attempt === maxRetries) {
        throw extractFriendlyGeminiError(err);
      }
      const delayMs = 900 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw extractFriendlyGeminiError(lastErr);
}

export const SUPPORTED_GEMINI_AUDIO_MIME_TYPES = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/mp3',
  'audio/mpeg',
  'audio/aiff',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  'audio/webm',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
]);

export function normalizeAudioMimeType(rawMime: string): string {
  const base = rawMime.split(';')[0].trim().toLowerCase();
  if (base === 'audio/m4a' || base === 'audio/x-m4a') return 'audio/mp4';
  if (base === 'audio/x-wav') return 'audio/wav';
  return base;
}

export interface AudioAnalysisResult {
  audio_summary: string;
  transcription: string;
  lyrics: string;
  mood: string[];
  possible_genres: string[];
  possible_instruments: string[];
  estimated_tempo: string | null;
  rhythm_description: string;
  musical_characteristics: string[];
  creative_recommendations: string[];
  confidence_notes: string[];
}

export async function analyzeRecordingWithGemini(params: {
  audioBuffer: Buffer;
  mimeType: string;
  title?: string;
  notes?: string;
  duration?: number;
}): Promise<AudioAnalysisResult> {
  const normalizedMime = normalizeAudioMimeType(params.mimeType);
  if (!SUPPORTED_GEMINI_AUDIO_MIME_TYPES.has(params.mimeType.split(';')[0].trim().toLowerCase())) {
    throw new Error(
      `Unsupported audio format "${params.mimeType}" for Gemini analysis. Supported formats: WAV, MP3, WebM, M4A/MP4, OGG, AAC, FLAC.`
    );
  }

  const maxBytes = 25 * 1024 * 1024;
  if (params.audioBuffer.length > maxBytes) {
    throw new Error(
      `Audio file is ${(params.audioBuffer.length / (1024 * 1024)).toFixed(1)} MB, which exceeds the 25 MB Gemini direct audio analysis limit.`
    );
  }

  const ai = getGeminiClient();
  const base64Audio = params.audioBuffer.toString('base64');

  const contextLines = [
    params.title ? `User-supplied sketch title: "${params.title}"` : '',
    params.notes ? `User notes: "${params.notes}"` : '',
    params.duration ? `Duration: ${params.duration.toFixed(1)} seconds` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const promptText = `Analyze the attached audio recording carefully as an experienced music producer and songwriting collaborator.

${contextLines ? `Optional user context (do not rely on this over what you actually hear in the audio):\n${contextLines}\n` : ''}
Instructions:
1. Base your entire analysis on the actual audio content you hear.
2. Identify whether the recording contains singing, humming, spoken word, instrumental playing, ambient sound, or a combination.
3. For transcription and lyrics:
   - Only transcribe spoken or sung words that are genuinely intelligible in the audio.
   - If the recording is purely instrumental, humming, mumbled, or unintelligible, return "" (empty string) for lyrics and clearly explain why in confidence_notes. NEVER invent or hallucinate lyrics.
4. For estimated_tempo:
   - Only provide a clearly qualified approximate tempo impression (e.g., "Approx. 88–96 BPM (relaxed mid-tempo)") if there is a steady audible pulse.
   - If there is no clear pulse (free-time, ambient, short spoken note, rubato), return null and explain in confidence_notes. Do NOT claim exact BPM, pitch, or musical key unless unmistakably clear.
5. Describe mood, possible genres, audible instruments (only when reasonably detectable), rhythm feel, musical characteristics, and practical creative next steps for developing this idea.`;

  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
      parts: [
        {
          inlineData: {
            mimeType: normalizedMime,
            data: base64Audio,
          },
        },
        { text: promptText },
      ],
    },
    config: {
      systemInstruction:
        'You are SoundScribe Audio Analyst, a precise, honest music production and songwriting analyst. Never fabricate lyrics, exact BPM, or exact key signatures when uncertain. Always document uncertainty in confidence_notes.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          audio_summary: {
            type: Type.STRING,
            description:
              'Concise, factual summary of what is heard in the audio (singing, humming, speech, instruments, texture, recording environment).',
          },
          transcription: {
            type: Type.STRING,
            description:
              'Verbatim transcription of intelligible speech or sung words, or a brief bracketed description if non-verbal (e.g. "[Instrumental acoustic guitar sketch]" or "[Humming melody without words]").',
          },
          lyrics: {
            type: Type.STRING,
            description:
              'Extracted intelligible sung/spoken lyrics formatted cleanly by line. Empty string "" if no intelligible lyrics exist.',
          },
          mood: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '2 to 5 mood/atmosphere descriptors grounded in the audio.',
          },
          possible_genres: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '2 to 4 plausible musical genres or stylistic references.',
          },
          possible_instruments: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Audible instruments or sound sources reasonably detectable in the recording.',
          },
          estimated_tempo: {
            type: Type.STRING,
            nullable: true,
            description:
              'Qualified approximate tempo impression if a steady pulse exists, otherwise null.',
          },
          rhythm_description: {
            type: Type.STRING,
            description: 'Description of rhythmic feel, groove, phrasing, or free-time pacing.',
          },
          musical_characteristics: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Notable melodic contour, dynamics, phrasing, vocal delivery, or harmonic impressions.',
          },
          creative_recommendations: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Actionable next creative steps for developing the recording into a fuller song.',
          },
          confidence_notes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Honest notes about ambiguity, recording noise, tempo uncertainty, or unintelligible sections.',
          },
        },
        required: [
          'audio_summary',
          'transcription',
          'lyrics',
          'mood',
          'possible_genres',
          'possible_instruments',
          'estimated_tempo',
          'rhythm_description',
          'musical_characteristics',
          'creative_recommendations',
          'confidence_notes',
        ],
      },
    },
  })
  );

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Gemini returned an empty response for audio analysis.');
  }

  return JSON.parse(text) as AudioAnalysisResult;
}

export interface DevelopIdeaResult {
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

export async function developIdeaWithGemini(params: {
  audioBuffer?: Buffer;
  mimeType?: string;
  title: string;
  notes?: string;
  transcript?: string;
  lyrics?: string;
  mood?: string[];
  genre?: string[];
  analysisSummary?: string;
  creativeFocus?: string;
}): Promise<DevelopIdeaResult> {
  const ai = getGeminiClient();

  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];

  if (params.audioBuffer && params.mimeType) {
    const baseMime = params.mimeType.split(';')[0].trim().toLowerCase();
    if (SUPPORTED_GEMINI_AUDIO_MIME_TYPES.has(baseMime) && params.audioBuffer.length <= 25 * 1024 * 1024) {
      parts.push({
        inlineData: {
          mimeType: normalizeAudioMimeType(params.mimeType),
          data: params.audioBuffer.toString('base64'),
        },
      });
    }
  }

  const prompt = `Develop a complete, editable songwriting and arrangement blueprint based on the musician's original sketch and context below.

Recording Title: "${params.title}"
User Notes: ${params.notes || 'None provided'}
Selected Moods: ${params.mood?.length ? params.mood.join(', ') : 'Not specified'}
Selected Genres: ${params.genre?.length ? params.genre.join(', ') : 'Not specified'}
Audio Analysis Summary: ${params.analysisSummary || 'Not yet analyzed'}
Transcribed Speech/Vocals: ${params.transcript || 'None'}
Existing Lyrics: ${params.lyrics || 'None'}
Creative Focus: ${params.creativeFocus || 'songwriting'}

Requirements:
1. Produce a practical, inspiring, structured composition development plan that preserves the musician's creative core.
2. Include all 7 standard song sections in structure: Intro, Verse 1, Pre-Chorus, Chorus, Verse 2, Bridge, Outro.
3. For chord_suggestions: Provide clear, playable chord names and progression examples (e.g., "Am - F - C - G" or "Dm9 - G13 - Cmaj7") tailored to the mood/genre, clearly framed as optional starting suggestions.
4. Include instrument suggestions, arrangement arc, tempo recommendations, vocal/performance delivery notes, and concrete next creative steps.`;

  parts.push({ text: prompt });

  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
    config: {
      systemInstruction:
        'You are SoundScribe Composition Architect, a veteran producer and songwriter helping an independent musician expand a raw sketch into a cohesive arrangement. Respect the artist’s voice and offer concrete, musical, playable ideas.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          suggested_title: { type: Type.STRING },
          creative_concept: { type: Type.STRING },
          song_description: { type: Type.STRING },
          structure: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                purpose: { type: Type.STRING },
                energy_notes: { type: Type.STRING },
                lyric_focus: { type: Type.STRING },
              },
              required: ['name', 'purpose', 'energy_notes', 'lyric_focus'],
            },
          },
          chord_suggestions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                section_name: { type: Type.STRING },
                chords: { type: Type.STRING },
                harmonic_feel: { type: Type.STRING },
              },
              required: ['section_name', 'chords', 'harmonic_feel'],
            },
          },
          instrument_suggestions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          arrangement_notes: { type: Type.STRING },
          tempo_recommendations: { type: Type.STRING },
          vocal_performance_suggestions: { type: Type.STRING },
          next_creative_steps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: [
          'suggested_title',
          'creative_concept',
          'song_description',
          'structure',
          'chord_suggestions',
          'instrument_suggestions',
          'arrangement_notes',
          'tempo_recommendations',
          'vocal_performance_suggestions',
          'next_creative_steps',
        ],
      },
    },
  })
  );

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Gemini returned an empty response while developing the composition.');
  }

  return JSON.parse(text) as DevelopIdeaResult;
}

export async function assistLyricsWithGemini(params: {
  action: 'continue' | 'rewrite' | 'chorus' | 'rhymes' | 'tone';
  title: string;
  currentLyrics: string;
  selectedText?: string;
  targetTone?: string;
  mood?: string;
  genre?: string;
}): Promise<{
  suggestions: Array<{ label: string; text: string; rationale: string }>;
}> {
  const ai = getGeminiClient();

  const actionInstructions: Record<string, string> = {
    continue: 'Write 2 distinct continuations that naturally extend the existing imagery, meter, and emotional arc.',
    rewrite: 'Provide 3 thoughtful rewrites of the selected lines (or main hook) preserving the core meaning while sharpening imagery and singability.',
    chorus: 'Generate 3 alternative chorus options that elevate the emotional payoff and melodic hook.',
    rhymes: 'Provide rich end-rhymes, slant/assonance rhymes, and short evocative phrase pairings for the highlighted words or lines.',
    tone: `Rewrite or adapt the provided lyrics toward a "${params.targetTone || 'more intimate and atmospheric'}" emotional tone while preserving the song's narrative anchor.`,
  };

  const prompt = `Song Title: "${params.title}"
Mood/Genre context: ${params.mood || 'Not specified'} / ${params.genre || 'Not specified'}

Full Original Lyrics (preserve this voice):
"""
${params.currentLyrics || '(Empty — starting from scratch based on title)'}
"""

${params.selectedText ? `Selected/Focus Lines:\n"""\n${params.selectedText}\n"""` : ''}

Task: ${actionInstructions[params.action]}`;

  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
    config: {
      systemInstruction:
        'You are a thoughtful songwriting lyricist collaborator. Never overwrite or discard the songwriter’s intent. Provide distinct, singable, cliché-free lyric options.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          suggestions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                text: { type: Type.STRING },
                rationale: { type: Type.STRING },
              },
              required: ['label', 'text', 'rationale'],
            },
          },
        },
        required: ['suggestions'],
      },
    },
  })
  );

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Gemini returned an empty response for lyric assistance.');
  }

  return JSON.parse(text);
}

export async function chatMusicAssistantWithGemini(params: {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  contextSummary?: string;
}): Promise<string> {
  const ai = getGeminiClient();

  const historyText = params.messages
    .slice(0, -1)
    .map((m) => `${m.role === 'user' ? 'Musician' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const latestUserMessage = params.messages[params.messages.length - 1]?.content ?? '';

  const prompt = [
    params.contextSummary ? `Active Workspace Context:\n${params.contextSummary}\n` : '',
    historyText ? `Conversation So Far:\n${historyText}\n` : '',
    `Musician: ${latestUserMessage}`,
  ]
    .filter(Boolean)
    .join('\n');

  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You are SoundScribe AI Music Assistant, an insightful studio producer, arranger, and songwriting partner. Give concrete, musical, grounded advice (chord voicings, rhythmic feels, lyric phrasing, arrangement dynamics, and production ideas). Keep formatting clean and scannable.',
      },
    })
  );

  const reply = (response.text ?? '').trim();
  if (!reply) {
    throw new Error('Gemini returned an empty response.');
  }
  return reply;
}
