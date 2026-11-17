import type { ProcessedAudioResult } from './audioProcessor.ts';
import type {
  AnalysisMode,
  RecordingContentType,
  StructuredAudioAnalysis,
} from '../src/types/soundscribe.ts';

export class GroqServiceError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = 'GroqServiceError';
    this.status = status;
  }
}

export function getGroqApiKey(): string | null {
  const key = process.env.GROQ_API_KEY;
  if (!key || key === 'MY_GROQ_API_KEY' || key.trim() === '') {
    return null;
  }
  return key.trim();
}

export function isGroqConfigured(): boolean {
  return Boolean(getGroqApiKey());
}

export function getGroqAudioModel(): string {
  return process.env.GROQ_AUDIO_MODEL?.trim() || 'whisper-large-v3';
}

export function getGroqChatModel(): string {
  return process.env.GROQ_CHAT_MODEL?.trim() || 'openai/gpt-oss-120b';
}

export interface GroqModelStatus {
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
}

/**
 * Checks and verifies the usability and deprecation status of Groq audio models.
 * As of 2026, whisper-large-v3 is ACTIVE, FULLY SUPPORTED, and NOT DEPRECATED on Groq free tier.
 */
export async function checkGroqAudioModelStatus(
  requestedModel?: string
): Promise<GroqModelStatus> {
  const model = requestedModel || getGroqAudioModel();

  // Known deprecation mapping based on official Groq documentation
  if (model === 'distil-whisper-large-v3-en') {
    return {
      model,
      usable: false,
      deprecated: true,
      status: 'deprecated',
      tier: 'free',
      details:
        'distil-whisper-large-v3-en has been deprecated by Groq. Please use whisper-large-v3 or whisper-large-v3-turbo.',
      rateLimits: {
        rpm: 0,
        rpd: 0,
        maxFileSizeMb: 25,
      },
    };
  }

  // Active models: whisper-large-v3 and whisper-large-v3-turbo
  const isActiveWhisper = model === 'whisper-large-v3' || model === 'whisper-large-v3-turbo';

  // If an API key is available, check with Groq's live models endpoint
  const apiKey = getGroqApiKey();
  if (apiKey) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (response.ok) {
        const data = (await response.json()) as { data?: Array<{ id: string; active?: boolean }> };
        const found = data.data?.find((m) => m.id === model);
        if (found) {
          return {
            model,
            usable: true,
            deprecated: false,
            status: 'active',
            tier: 'free',
            details: `Model "${model}" verified active and ready on Groq Cloud.`,
            rateLimits: {
              rpm: 20,
              rpd: 2000,
              audioSecondsPerHour: 7200,
              audioSecondsPerDay: 28800,
              maxFileSizeMb: 25,
            },
          };
        }
      }
    } catch {
      // Network or offline check fallback
    }
  }

  return {
    model,
    usable: isActiveWhisper,
    deprecated: !isActiveWhisper && model.includes('distil'),
    status: isActiveWhisper ? 'active' : 'unknown',
    tier: 'free',
    details: isActiveWhisper
      ? `Model "${model}" is active and supported on the Groq free tier (20 RPM, 2000 RPD, 7,200s audio/hr, max 25MB).`
      : `Model "${model}" status could not be verified against Groq known models.`,
    rateLimits: {
      rpm: 20,
      rpd: 2000,
      audioSecondsPerHour: 7200,
      audioSecondsPerDay: 28800,
      maxFileSizeMb: 25,
    },
  };
}

export interface GroqWhisperSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  no_speech_prob?: number;
  avg_logprob?: number;
}

export interface GroqWhisperResult {
  text: string;
  language?: string;
  duration?: number;
  segments?: GroqWhisperSegment[];
  isVerbal: boolean;
  model: string;
}

function classifyGroqError(status: number, errorData: unknown): GroqServiceError {
  let message = 'Groq API request failed.';
  if (typeof errorData === 'object' && errorData !== null) {
    const err = (errorData as { error?: { message?: string; type?: string; code?: string } }).error;
    if (err?.message) {
      message = err.message;
    }
  } else if (typeof errorData === 'string') {
    message = errorData;
  }

  if (status === 401 || status === 403) {
    return new GroqServiceError(
      'Groq API key authentication failed. Please verify your GROQ_API_KEY in .env or Settings.',
      403
    );
  }
  if (status === 429) {
    return new GroqServiceError(
      'Groq API rate limit reached (20 RPM or 7,200 audio sec/hr limit on free tier). Please wait a moment and try again.',
      429
    );
  }
  if (status === 503 || status === 502) {
    return new GroqServiceError(
      'Groq audio processing service is temporarily unavailable (503). Please retry in a few seconds.',
      503
    );
  }
  if (status === 400) {
    return new GroqServiceError(
      `Groq audio transcription error: ${message}`,
      400
    );
  }

  return new GroqServiceError(message, status);
}

/**
 * Transcribe audio using Groq's official OpenAI-compatible Whisper endpoint:
 * POST https://api.groq.com/openai/v1/audio/transcriptions
 */
export async function transcribeWithGroqWhisper(params: {
  audioBuffer: Buffer;
  mimeType: string;
  originalFilename?: string;
  prompt?: string;
  model?: string;
  timeoutMs?: number;
}): Promise<GroqWhisperResult> {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    throw new GroqServiceError(
      'GROQ_API_KEY is not configured on the server. Add your free Groq API key in .env or Settings.',
      503
    );
  }

  const model = params.model || getGroqAudioModel();

  // Validate model is not deprecated
  if (model === 'distil-whisper-large-v3-en') {
    throw new GroqServiceError(
      'distil-whisper-large-v3-en is deprecated on Groq. Please use whisper-large-v3 in GROQ_AUDIO_MODEL.',
      400
    );
  }

  // Determine file extension from mime type
  const baseMime = params.mimeType.split(';')[0].trim().toLowerCase();
  let ext = 'wav';
  if (baseMime.includes('mp3') || baseMime.includes('mpeg')) ext = 'mp3';
  else if (baseMime.includes('flac')) ext = 'flac';
  else if (baseMime.includes('ogg')) ext = 'ogg';
  else if (baseMime.includes('mp4') || baseMime.includes('m4a')) ext = 'm4a';
  else if (baseMime.includes('webm')) ext = 'webm';

  const filename = params.originalFilename || `recording.${ext}`;

  const formData = new FormData();
  const fileBlob = new Blob([new Uint8Array(params.audioBuffer)], { type: baseMime });
  formData.append('file', fileBlob, filename);
  formData.append('model', model);
  formData.append('response_format', 'verbose_json');
  formData.append('temperature', '0');

  if (params.prompt) {
    formData.append('prompt', params.prompt.slice(0, 448));
  }

  const timeoutMs = params.timeoutMs || 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'SoundScribe-Audio-Analysis-Engine/1.0',
      },
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      let errBody: unknown;
      try {
        errBody = await response.json();
      } catch {
        errBody = await response.text();
      }
      throw classifyGroqError(response.status, errBody);
    }

    const data = (await response.json()) as {
      text?: string;
      language?: string;
      duration?: number;
      segments?: Array<{
        id: number;
        start: number;
        end: number;
        text: string;
        no_speech_prob?: number;
        avg_logprob?: number;
      }>;
    };

    const rawText = (data.text || '').trim();

    // Analyze if text has actual verbal content or is non-verbal/silence/humming
    const isMusicOrNonVerbalMarker =
      /^(\[(music|applause|laughter|silence|singing|humming|groan|sigh)\]|\((music|applause|laughter|silence)\)|\.+|\*+)$/i.test(
        rawText
      );

    const hasHighNoSpeechProb =
      data.segments &&
      data.segments.length > 0 &&
      data.segments.every((s) => (s.no_speech_prob ?? 0) > 0.65);

    const isVerbal = Boolean(rawText) && !isMusicOrNonVerbalMarker && !hasHighNoSpeechProb;

    return {
      text: isVerbal ? rawText : '',
      language: data.language,
      duration: data.duration,
      segments: data.segments,
      isVerbal,
      model,
    };
  } catch (err: unknown) {
    if (err instanceof GroqServiceError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new GroqServiceError(
        `Groq Whisper transcription timed out after ${Math.round(timeoutMs / 1000)}s.`,
        504
      );
    }
    throw new GroqServiceError(
      err instanceof Error ? err.message : 'Groq Whisper transcription request failed.',
      500
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function clampConfidence(val: unknown): number | null {
  if (typeof val !== 'number' || !Number.isFinite(val)) return null;
  return Number(Math.max(0, Math.min(1, val)).toFixed(2));
}

function sanitizeStringArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean);
}

function sanitizeRecordingType(val: unknown): RecordingContentType {
  const allowed: RecordingContentType[] = [
    'humming',
    'singing',
    'speech',
    'instrumental',
    'mixed',
    'unknown',
  ];
  return allowed.includes(val as RecordingContentType)
    ? (val as RecordingContentType)
    : 'unknown';
}

/**
 * Execute a Groq Chat Completion with JSON mode using LLaMA 3.3 70B (or 3.1 8B fallback)
 */
async function callGroqJsonChat(params: {
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
}): Promise<string> {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    throw new GroqServiceError('GROQ_API_KEY is not configured.', 503);
  }

  const candidateModels = Array.from(
    new Set(
      [
        getGroqChatModel(),
        'openai/gpt-oss-120b',
        'openai/gpt-oss-20b',
        'qwen/qwen3.8-27b',
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
      ].filter(Boolean)
    )
  );
  const timeoutMs = params.timeoutMs || 30000;

  let lastError: unknown;

  for (const model of candidateModels) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'SoundScribe-Audio-Analysis-Engine/1.0',
        },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          temperature: 0.2,
          messages: [
            { role: 'system', content: params.systemPrompt },
            { role: 'user', content: params.userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errBody: unknown;
        try {
          errBody = await response.json();
        } catch {
          errBody = await response.text();
        }
        throw classifyGroqError(response.status, errBody);
      }

      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = json.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new GroqServiceError(`Groq chat model ${model} returned empty content.`, 502);
      }
      return content;
    } catch (err) {
      lastError = err;
      if (err instanceof GroqServiceError && err.status !== 503 && err.status !== 502 && err.status !== 404) {
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new GroqServiceError('Groq chat completions failed.', 500);
}

/**
 * Full audio analysis using Groq's whisper-large-v3 speech recognition + server DSP telemetry + Groq LLaMA JSON reasoning.
 */
export async function analyzeRecordingWithGroq(params: {
  processedAudio: ProcessedAudioResult;
  analysisMode: AnalysisMode;
  title?: string;
  notes?: string;
  onStage?: (stage: string, detail: string) => void;
}): Promise<StructuredAudioAnalysis> {
  const { processedAudio, analysisMode } = params;
  const { dsp, geminiBuffer, geminiMimeType, detectedContainer } = processedAudio;

  const whisperModel = getGroqAudioModel();
  params.onStage?.('analyzing', `Transcribing audio with Groq (${whisperModel})...`);

  // Step 1: Transcribe using Groq Whisper
  let whisperResult: GroqWhisperResult;
  try {
    whisperResult = await transcribeWithGroqWhisper({
      audioBuffer: geminiBuffer,
      mimeType: geminiMimeType,
      originalFilename: `audio.${detectedContainer.format}`,
      prompt: params.title ? `Song sketch: ${params.title}` : undefined,
    });
  } catch (err) {
    if (err instanceof GroqServiceError && err.status === 429) {
      throw err;
    }
    // If whisper fails on pure non-verbal recording, fall back gracefully
    whisperResult = {
      text: '',
      isVerbal: false,
      model: whisperModel,
    };
  }

  params.onStage?.('extracting', 'Synthesizing acoustic DSP telemetry & musical structure...');

  const dspSummaryLines = [
    `Original container detected: ${detectedContainer.format.toUpperCase()} (${detectedContainer.mimeType})`,
    `Codec: ${dsp.codecName} | Duration: ${dsp.durationSeconds.toFixed(2)}s | Sample rate: ${dsp.sampleRate} Hz`,
    `Signal energy: RMS ${dsp.rmsLevel}, Peak ${dsp.peakLevel}, Active ratio ${Math.round(dsp.activeRatio * 100)}%`,
    `Pitch tracking (YIN 70–850 Hz): ${dsp.voicedFrameCount} voiced frames (${Math.round(dsp.voicedRatio * 100)}% of active frames)`,
    dsp.minPitchHz && dsp.maxPitchHz
      ? `Measured pitch range: ${dsp.minPitchHz} Hz – ${dsp.maxPitchHz} Hz (span: ${dsp.pitchRangeSemitones} semitones, median ${dsp.medianPitchHz} Hz)`
      : 'Measured pitch range: No steady pitched frames detected',
    `Measured melodic contour: ${dsp.contourDescription}`,
    `Repeating melodic interval motif detected: ${dsp.repeatingPhraseDetected ? 'Yes' : 'No'}`,
    dsp.estimatedKey
      ? `DSP tonal center candidate: ${dsp.estimatedKey} (correlation ${dsp.keyConfidence})`
      : 'DSP tonal center candidate: Insufficient stable tonal evidence (do NOT invent an exact key unless unmistakably clear)',
    dsp.estimatedBpm
      ? `DSP onset-autocorrelation tempo candidate: ${dsp.estimatedBpm} BPM (correlation ${dsp.tempoConfidence}, onset density ${dsp.onsetDensityPerSec}/s)`
      : `DSP tempo candidate: No steady rhythmic pulse detected (onset density ${dsp.onsetDensityPerSec}/s — keep estimated_bpm null unless a clear steady beat is unmistakably audible)`,
  ].join('\n');

  const whisperTelemetry = [
    `Groq Whisper Model: ${whisperResult.model}`,
    `Detected Language: ${whisperResult.language || 'unspecified'}`,
    `Verbal Speech / Sung Lyrics Detected: ${whisperResult.isVerbal ? 'YES' : 'NO (Instrumental, Humming, or Non-verbal)'}`,
    whisperResult.text ? `Whisper Verbatim Transcript:\n"""\n${whisperResult.text}\n"""` : 'Whisper Transcript: [No intelligible spoken/sung words detected]',
  ].join('\n');

  const modeInstructions =
    analysisMode === 'humming'
      ? `SELECTED MODE: Humming / Melody Analysis.
Prioritize melodic contour, pitch movement, phrase repetition, rhythmic groove/pulse, tonal impressions, mood, genre feel, instrument/arrangement pairing, and melody development ideas.
- Leave lyrics as "" unless clearly articulated sung words exist.
- Use the measured DSP pitch range, contour, and BPM/key evidence honestly.`
      : analysisMode === 'voice'
        ? `SELECTED MODE: Voice / Lyrics Analysis.
Prioritize verbatim speech/vocal transcription, extracting sung lyrics vs spoken thoughts, vocal delivery/tone/cadence characteristics, mood, song structure cues, and lyric development suggestions.
- If the recording is spoken thoughts without melody, set melody.detected to false and melody.estimated_key to null.`
        : `SELECTED MODE: Automatic Detection.
Determine honestly from the audio and telemetry whether the recording is humming, singing, speech, instrumental, or mixed, and set recording_type accordingly.
- If humming/instrumental: focus on melody, pitch contour, rhythm, instrumentation, and set lyrics to "".
- If speech: transcribe accurately, describe vocal cadence/intent, and set melody.detected to false unless clear singing occurs.
- If singing: provide both verbatim lyrics/transcription AND melody/rhythm analysis.`;

  const systemPrompt = `You are SoundScribe Audio Analysis Engine powered by Groq Whisper and server-side DSP telemetry.
You perform rigorous, truthful analysis of humming, singing, speech, and instrumental recordings.
Never fabricate lyrics, exact BPM, key signatures, or musical notes when unmeasurable.
You must respond with valid JSON matching the requested schema.`;

  const userPrompt = `Analyze this audio recording based on the measured server-side DSP telemetry and Groq Whisper transcription.

${modeInstructions}

Measured Server-Side Acoustic & DSP Telemetry (from decoded 16kHz PCM audio):
${dspSummaryLines}

Groq Whisper Audio Transcription Telemetry:
${whisperTelemetry}

${params.title ? `User sketch title: "${params.title}"` : ''}
${params.notes ? `User notes: "${params.notes}"` : ''}

STRICT HONESTY RULES:
1. Base every claim strictly on the DSP measurements and Whisper transcript above.
2. NEVER hallucinate or invent lyrics. If Whisper detected no words, lyrics MUST be "" and transcription should be a factual bracketed tag like "[Humming melody without lyrics]" or "[Acoustic instrumental]".
3. NEVER invent exact BPM or musical key when unclear. Set melody.estimated_key or rhythm.estimated_bpm to null whenever uncertain, and record the reason in limitations.
4. For ordinary speech with no melodic singing, set melody.detected = false, melody.estimated_key = null.

Return a single JSON object with these EXACT keys:
{
  "recording_type": "humming" | "singing" | "speech" | "instrumental" | "mixed" | "unknown",
  "audio_summary": "factual summary string",
  "transcription": "verbatim spoken/sung transcription or bracketed acoustic description",
  "lyrics": "line-broken sung lyrics (empty string if humming, instrumental, or spoken thought)",
  "melody": {
    "detected": true/false,
    "contour": "description of melodic contour or 'No melody detected'",
    "pitch_observations": ["string"],
    "estimated_key": "string or null",
    "confidence": 0.0 to 1.0 or null
  },
  "rhythm": {
    "detected": true/false,
    "estimated_bpm": number or null,
    "pattern": "description of rhythmic feel or groove",
    "confidence": 0.0 to 1.0 or null
  },
  "mood": ["string"],
  "possible_genres": ["string"],
  "possible_instruments": ["string"],
  "vocal_characteristics": ["string"],
  "musical_characteristics": ["string"],
  "creative_recommendations": ["string"],
  "limitations": ["string"]
}`;

  const jsonText = await callGroqJsonChat({ systemPrompt, userPrompt });

  let parsed: Partial<StructuredAudioAnalysis>;
  try {
    parsed = JSON.parse(jsonText) as Partial<StructuredAudioAnalysis>;
  } catch {
    throw new GroqServiceError('Groq returned malformed JSON during audio analysis.', 502);
  }

  let recordingType = sanitizeRecordingType(parsed.recording_type);
  if (recordingType === 'unknown') {
    if (whisperResult.isVerbal) {
      recordingType = dsp.voicedRatio > 0.45 && dsp.pitchRangeSemitones >= 4 ? 'singing' : 'speech';
    } else if (dsp.voicedRatio > 0.35) {
      recordingType = 'humming';
    } else {
      recordingType = 'instrumental';
    }
  }

  const limitations = sanitizeStringArray(parsed.limitations);

  // Ground BPM with DSP measurements
  let estimatedBpm =
    typeof parsed.rhythm?.estimated_bpm === 'number' &&
    Number.isFinite(parsed.rhythm.estimated_bpm) &&
    parsed.rhythm.estimated_bpm >= 40 &&
    parsed.rhythm.estimated_bpm <= 220
      ? Math.round(parsed.rhythm.estimated_bpm)
      : null;

  if (!estimatedBpm && dsp.estimatedBpm && (dsp.tempoConfidence ?? 0) >= 0.45 && recordingType !== 'speech') {
    estimatedBpm = dsp.estimatedBpm;
  }

  if (recordingType === 'speech') {
    estimatedBpm = null;
  }

  // Ground Key with DSP measurements
  let estimatedKey =
    typeof parsed.melody?.estimated_key === 'string' && parsed.melody.estimated_key.trim()
      ? parsed.melody.estimated_key.trim()
      : null;

  if (!estimatedKey && dsp.estimatedKey && (dsp.keyConfidence ?? 0) >= 0.78 && recordingType !== 'speech') {
    estimatedKey = dsp.estimatedKey;
  }

  if (recordingType === 'speech' || parsed.melody?.detected === false) {
    estimatedKey = null;
  }

  if (estimatedBpm === null && !limitations.some((l) => l.toLowerCase().includes('tempo') || l.toLowerCase().includes('bpm'))) {
    limitations.push('No steady rhythmic pulse detected; BPM was left unmeasured rather than guessed.');
  }
  if (estimatedKey === null && (parsed.melody?.detected ?? false) && !limitations.some((l) => l.toLowerCase().includes('key') || l.toLowerCase().includes('tonal'))) {
    limitations.push('Tonal center/key was ambiguous across this short take; key left unconfirmed.');
  }

  // Ground pitch observations with real DSP pitch span
  const pitchObservations = sanitizeStringArray(parsed.melody?.pitch_observations);
  if ((parsed.melody?.detected ?? false) && dsp.minPitchHz && dsp.maxPitchHz) {
    const dspObs = `Measured vocal/melodic pitch span: ${dsp.minPitchHz} Hz – ${dsp.maxPitchHz} Hz (~${dsp.pitchRangeSemitones} semitones).`;
    if (!pitchObservations.some((o) => o.includes('Hz'))) {
      pitchObservations.unshift(dspObs);
    }
  }

  const finalTranscript =
    whisperResult.text ||
    (typeof parsed.transcription === 'string' ? parsed.transcription.trim() : '') ||
    (recordingType === 'humming'
      ? '[Humming melody without lyrics]'
      : recordingType === 'instrumental'
        ? '[Acoustic instrumental]'
        : '[No intelligible speech detected]');

  const finalLyrics =
    recordingType === 'humming' || recordingType === 'instrumental' || recordingType === 'speech'
      ? ''
      : typeof parsed.lyrics === 'string' && parsed.lyrics.trim()
        ? parsed.lyrics.trim()
        : whisperResult.text;

  return {
    recording_type: recordingType,
    analysis_mode: analysisMode,
    audio_summary:
      (typeof parsed.audio_summary === 'string' ? parsed.audio_summary.trim() : '') ||
      `Processed ${dsp.durationSeconds.toFixed(1)}s ${detectedContainer.format.toUpperCase()} audio recording with Groq ${whisperModel}.`,
    transcription: finalTranscript,
    lyrics: finalLyrics,
    melody: {
      detected: Boolean(parsed.melody?.detected) && recordingType !== 'speech',
      contour:
        (typeof parsed.melody?.contour === 'string' ? parsed.melody.contour.trim() : '') ||
        (recordingType === 'speech' ? 'No melodic contour detected (spoken audio).' : dsp.contourDescription),
      pitch_observations: pitchObservations,
      estimated_key: estimatedKey,
      confidence: clampConfidence(parsed.melody?.confidence ?? dsp.keyConfidence),
    },
    rhythm: {
      detected: Boolean(parsed.rhythm?.detected),
      estimated_bpm: estimatedBpm,
      pattern:
        (typeof parsed.rhythm?.pattern === 'string' ? parsed.rhythm.pattern.trim() : '') ||
        'Free-time phrasing without a strict metronomic beat.',
      confidence: clampConfidence(parsed.rhythm?.confidence ?? dsp.tempoConfidence),
    },
    mood: sanitizeStringArray(parsed.mood),
    possible_genres: sanitizeStringArray(parsed.possible_genres),
    possible_instruments: sanitizeStringArray(parsed.possible_instruments),
    vocal_characteristics: sanitizeStringArray(parsed.vocal_characteristics),
    musical_characteristics: sanitizeStringArray(parsed.musical_characteristics),
    creative_recommendations: sanitizeStringArray(parsed.creative_recommendations),
    limitations,
  };
}

export interface GroqDevelopIdeaResult {
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

export async function developIdeaWithGroq(params: {
  title: string;
  notes?: string;
  transcript?: string;
  lyrics?: string;
  mood?: string[];
  genre?: string[];
  analysisSummary?: string;
  creativeFocus?: string;
}): Promise<GroqDevelopIdeaResult> {
  const systemPrompt = `You are SoundScribe Composition Architect, a veteran producer and songwriter helping an independent musician expand a raw sketch into a cohesive arrangement. Respect the artist’s voice and offer concrete, musical, playable ideas. You must respond with valid JSON matching the requested schema.`;

  const userPrompt = `Develop a complete, editable songwriting and arrangement blueprint based on the musician's sketch and context below.

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
2. Include standard song sections in structure: Intro, Verse 1, Pre-Chorus, Chorus, Verse 2, Bridge, Outro.
3. For chord_suggestions: Provide clear, playable chord names and progression examples (e.g., "Am - F - C - G") tailored to the mood/genre.
4. Include instrument suggestions, arrangement notes, tempo recommendations, vocal performance delivery suggestions, and next creative steps.

Return a single JSON object with these EXACT keys:
{
  "suggested_title": "string",
  "creative_concept": "string",
  "song_description": "string",
  "structure": [{ "name": "string", "purpose": "string", "energy_notes": "string", "lyric_focus": "string" }],
  "chord_suggestions": [{ "section_name": "string", "chords": "string", "harmonic_feel": "string" }],
  "instrument_suggestions": ["string"],
  "arrangement_notes": "string",
  "tempo_recommendations": "string",
  "vocal_performance_suggestions": "string",
  "next_creative_steps": ["string"]
}`;

  const jsonText = await callGroqJsonChat({ systemPrompt, userPrompt });
  try {
    return JSON.parse(jsonText) as GroqDevelopIdeaResult;
  } catch {
    throw new GroqServiceError('Groq returned malformed JSON during composition development.', 502);
  }
}

export async function assistLyricsWithGroq(params: {
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
  const actionInstructions: Record<string, string> = {
    continue: 'Write 2 distinct continuations that naturally extend the existing imagery, meter, and emotional arc.',
    rewrite: 'Provide 3 thoughtful rewrites of the selected lines (or main hook) preserving the core meaning while sharpening imagery and singability.',
    chorus: 'Generate 3 alternative chorus options that elevate the emotional payoff and melodic hook.',
    rhymes: 'Provide rich end-rhymes, slant/assonance rhymes, and short evocative phrase pairings for the highlighted words or lines.',
    tone: `Rewrite or adapt the provided lyrics toward a "${params.targetTone || 'more intimate and atmospheric'}" emotional tone while preserving the song's narrative anchor.`,
  };

  const systemPrompt = `You are a thoughtful songwriting lyricist collaborator. Never overwrite or discard the songwriter’s intent. Provide distinct, singable, cliché-free lyric options. You must respond with valid JSON matching the requested schema.`;

  const userPrompt = `Song Title: "${params.title}"
Mood/Genre context: ${params.mood || 'Not specified'} / ${params.genre || 'Not specified'}

Full Original Lyrics:
"""
${params.currentLyrics || '(Empty — starting from scratch based on title)'}
"""

${params.selectedText ? `Selected/Focus Lines:\n"""\n${params.selectedText}\n"""` : ''}

Task: ${actionInstructions[params.action] || actionInstructions.continue}

Return a single JSON object with this EXACT structure:
{
  "suggestions": [
    {
      "label": "short descriptive label",
      "text": "the proposed lyric text (with line breaks)",
      "rationale": "why this works musically and emotionally"
    }
  ]
}`;

  const jsonText = await callGroqJsonChat({ systemPrompt, userPrompt });
  try {
    return JSON.parse(jsonText) as {
      suggestions: Array<{ label: string; text: string; rationale: string }>;
    };
  } catch {
    throw new GroqServiceError('Groq returned malformed JSON during lyric assistance.', 502);
  }
}

export async function chatMusicAssistantWithGroq(params: {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  contextSummary?: string;
}): Promise<string> {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    throw new GroqServiceError('GROQ_API_KEY is not configured.', 503);
  }

  const model = getGroqChatModel();
  const systemMessage = {
    role: 'system',
    content:
      'You are SoundScribe AI Music Assistant, an insightful studio producer, arranger, and songwriting partner. Give concrete, musical, grounded advice (chord voicings, rhythmic feels, lyric phrasing, arrangement dynamics, and production ideas). Keep formatting clean and scannable.' +
      (params.contextSummary ? `\nActive Studio Context: ${params.contextSummary}` : ''),
  };

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'SoundScribe-Audio-Analysis-Engine/1.0',
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      messages: [systemMessage, ...params.messages],
    }),
  });

  if (!response.ok) {
    let errBody: unknown;
    try {
      errBody = await response.json();
    } catch {
      errBody = await response.text();
    }
    throw classifyGroqError(response.status, errBody);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const reply = json.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    throw new GroqServiceError('Groq returned an empty response.', 502);
  }
  return reply;
}
