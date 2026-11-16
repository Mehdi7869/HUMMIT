import { GoogleGenAI, Type } from '@google/genai';
import type { ProcessedAudioResult } from './audioProcessor.ts';
import type {
  AnalysisMode,
  RecordingContentType,
  StructuredAudioAnalysis,
} from '../src/types/soundscribe.ts';

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

export class GeminiServiceError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = 'GeminiServiceError';
    this.status = status;
  }
}

function classifyGeminiError(err: unknown): GeminiServiceError {
  if (err instanceof GeminiServiceError) return err;
  const raw = err instanceof Error ? err.message : String(err);

  let code: number | undefined;
  let statusStr: string | undefined;
  let parsedMsg: string | undefined;

  try {
    const parsed = JSON.parse(raw);
    code = parsed?.error?.code;
    statusStr = parsed?.error?.status;
    parsedMsg = parsed?.error?.message;
  } catch {
    // not JSON
  }

  if (code === 401 || code === 403 || raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID')) {
    return new GeminiServiceError(
      'Gemini API authentication failed. Please verify your API key in Settings > Secrets.',
      403
    );
  }
  if (code === 429 || statusStr === 'RESOURCE_EXHAUSTED' || raw.includes('429')) {
    return new GeminiServiceError(
      'Gemini API rate limit reached (429). Please wait a moment and click Retry Analysis.',
      429
    );
  }
  if (raw.toLowerCase().includes('timed out') || raw.toLowerCase().includes('timeout')) {
    return new GeminiServiceError(
      'Gemini audio analysis timed out while waiting for a response. Please click Retry Analysis.',
      504
    );
  }
  if (code === 503 || statusStr === 'UNAVAILABLE' || raw.includes('503') || raw.includes('UNAVAILABLE')) {
    return new GeminiServiceError(
      'Gemini AI audio service is temporarily overloaded (503). Please click Retry Analysis in a few seconds.',
      503
    );
  }
  if (code === 404 || statusStr === 'NOT_FOUND') {
    return new GeminiServiceError(
      parsedMsg || 'Selected Gemini model was not found or is unavailable.',
      502
    );
  }

  return new GeminiServiceError(parsedMsg || raw || 'Gemini request failed.', 500);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new GeminiServiceError(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`, 504));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const MODEL_FALLBACK_ORDER = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;

async function runWithModelFallback<T>(
  operationLabel: string,
  fn: (model: string) => Promise<T>,
  timeoutMs = 24000
): Promise<T> {
  let lastError: unknown;

  for (let mIdx = 0; mIdx < MODEL_FALLBACK_ORDER.length; mIdx++) {
    const model = MODEL_FALLBACK_ORDER[mIdx];
    const maxAttempts = mIdx === 0 ? 2 : 2;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await withTimeout(fn(model), timeoutMs, `${operationLabel} (${model})`);
      } catch (err) {
        lastError = err;
        const classified = classifyGeminiError(err);
        const shouldRetryOrFallback =
          classified.status === 503 ||
          classified.status === 429 ||
          classified.status === 504 ||
          classified.status === 502;

        if (!shouldRetryOrFallback) {
          throw classified;
        }
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        }
      }
    }
  }

  throw classifyGeminiError(lastError);
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

async function transcribeWithDedicatedModel(
  ai: GoogleGenAI,
  mimeType: string,
  base64Audio: string
): Promise<string | null> {
  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Audio,
              },
            },
            {
              text: 'Provide an exact verbatim transcription of any intelligible spoken or sung words in this audio. If there are no intelligible words (e.g. only humming, whistling, or instruments), reply strictly with [NO_INTELLIGIBLE_WORDS].',
            },
          ],
        },
      }),
      12000,
      'Audio transcription'
    );

    const text = (response.text ?? '').trim();
    if (!text || text.includes('[NO_INTELLIGIBLE_WORDS]')) {
      return null;
    }
    return text;
  } catch {
    return null;
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

export async function analyzeRecordingWithGemini(params: {
  processedAudio: ProcessedAudioResult;
  analysisMode: AnalysisMode;
  title?: string;
  notes?: string;
  onStage?: (stage: 'analyzing' | 'extracting', detail: string) => void;
}): Promise<StructuredAudioAnalysis> {
  const { processedAudio, analysisMode } = params;
  const { dsp, geminiBuffer, geminiMimeType, detectedContainer } = processedAudio;

  const ai = getGeminiClient();
  const base64Audio = geminiBuffer.toString('base64');

  params.onStage?.('analyzing', 'Submitting processed audio to Gemini AI...');

  // For voice/lyrics focus (or auto when speech/singing may be present), optionally get a
  // crisp verbatim transcript from gemini-3.5-transcribe to ground lyric extraction.
  let dedicatedTranscript: string | null = null;
  if (analysisMode === 'voice') {
    dedicatedTranscript = await transcribeWithDedicatedModel(ai, geminiMimeType, base64Audio);
  }

  const dspSummaryLines = [
    `Original container detected by file signature: ${detectedContainer.format.toUpperCase()} (${detectedContainer.mimeType})`,
    `Codec: ${dsp.codecName} | Processed duration: ${dsp.durationSeconds.toFixed(2)}s | Sample rate: ${dsp.sampleRate} Hz`,
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

  const modeInstructions =
    analysisMode === 'humming'
      ? `SELECTED MODE: Mode A — Humming / Melody Analysis.
Prioritize melodic contour, pitch movement, phrase repetition, rhythmic groove/pulse, tonal impressions, mood, genre feel, instrument/arrangement pairing, and melody development ideas.
- Leave lyrics as "" unless clearly articulated sung words exist.
- Use the measured DSP pitch range, contour, and BPM/key evidence honestly. If tempo or key cannot be reliably determined, return null and note why in limitations.`
      : analysisMode === 'voice'
        ? `SELECTED MODE: Mode B — Voice / Lyrics Analysis.
Prioritize verbatim speech/vocal transcription, extracting sung lyrics vs spoken thoughts, vocal delivery/tone/cadence characteristics, mood, song structure cues, and lyric development suggestions.
- If the recording is spoken thoughts without melody, set melody.detected to false and melody.estimated_key to null; do NOT invent musical notes or key signatures for ordinary speech.`
        : `SELECTED MODE: Automatic Detection.
Determine honestly from the audio whether the recording is humming, singing, speech, instrumental, or mixed, and set recording_type accordingly.
- If humming/instrumental: focus on melody, pitch contour, rhythm, instrumentation, and set lyrics to "".
- If speech: transcribe accurately, describe vocal cadence/intent, and set melody.detected to false unless clear singing occurs.
- If singing: provide both verbatim lyrics/transcription AND melody/rhythm analysis.`;

  const contextLines = [
    params.title ? `User sketch title: "${params.title}"` : '',
    params.notes ? `User notes: "${params.notes}"` : '',
    dedicatedTranscript ? `Auxiliary verbatim speech-to-text pass: "${dedicatedTranscript}"` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const promptText = `Analyze the attached normalized audio recording as a senior music producer, acoustic analyst, and songwriting collaborator.

${modeInstructions}

Measured Server-Side Acoustic & DSP Telemetry (from decoded 16kHz PCM audio):
${dspSummaryLines}

${contextLines ? `Optional Context (never override what is actually heard in the audio):\n${contextLines}\n` : ''}
STRICT HONESTY RULES:
1. Base every claim strictly on what you actually hear in the audio plus the DSP measurements above.
2. NEVER hallucinate or invent lyrics. If humming, mumbled, instrumental, or unintelligible, lyrics MUST be "" and transcription should be a factual bracketed tag like "[Humming melody without lyrics]" or "[Acoustic instrumental]".
3. NEVER invent exact BPM or musical key when unclear. Set melody.estimated_key or rhythm.estimated_bpm to null whenever uncertain, and record the reason in limitations.
4. For ordinary speech with no melodic singing, set melody.detected = false, melody.estimated_key = null, and focus on transcription, vocal delivery, and songwriting ideas.`;

  const response = await runWithModelFallback('Audio analysis', (model) =>
    ai.models.generateContent({
      model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: geminiMimeType,
              data: base64Audio,
            },
          },
          { text: promptText },
        ],
      },
      config: {
        systemInstruction:
          'You are SoundScribe Audio Analysis Engine. You perform rigorous, truthful analysis of humming, singing, speech, and instrumental recordings. Never fabricate lyrics, exact BPM, key signatures, or musical notes when unmeasurable.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recording_type: {
              type: Type.STRING,
              description: 'One of: humming, singing, speech, instrumental, mixed, unknown',
            },
            audio_summary: {
              type: Type.STRING,
              description: 'Factual summary of what is heard in the recording.',
            },
            transcription: {
              type: Type.STRING,
              description:
                'Verbatim spoken/sung transcription, or bracketed acoustic description if non-verbal.',
            },
            lyrics: {
              type: Type.STRING,
              description:
                'Line-broken intelligible sung lyrics (empty string "" if humming, instrumental, or pure non-lyric speech).',
            },
            melody: {
              type: Type.OBJECT,
              properties: {
                detected: { type: Type.BOOLEAN },
                contour: {
                  type: Type.STRING,
                  description:
                    'Description of melodic contour, direction, interval movement, or "No melody detected" for plain speech.',
                },
                pitch_observations: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Specific observations about register, phrase repetition, stability, or range.',
                },
                estimated_key: {
                  type: Type.STRING,
                  nullable: true,
                  description: 'Tonal center/key only if reliably measurable, otherwise null.',
                },
                confidence: {
                  type: Type.NUMBER,
                  nullable: true,
                  description: '0.0 to 1.0 confidence in melodic assessment, or null.',
                },
              },
              required: ['detected', 'contour', 'pitch_observations', 'estimated_key', 'confidence'],
            },
            rhythm: {
              type: Type.OBJECT,
              properties: {
                detected: { type: Type.BOOLEAN },
                estimated_bpm: {
                  type: Type.NUMBER,
                  nullable: true,
                  description: 'Numeric BPM only if steady pulse exists, otherwise null.',
                },
                pattern: {
                  type: Type.STRING,
                  description: 'Description of rhythmic feel, groove, meter, phrasing, or free-time cadence.',
                },
                confidence: {
                  type: Type.NUMBER,
                  nullable: true,
                  description: '0.0 to 1.0 confidence in tempo/rhythm assessment, or null.',
                },
              },
              required: ['detected', 'estimated_bpm', 'pattern', 'confidence'],
            },
            mood: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            possible_genres: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            possible_instruments: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            vocal_characteristics: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Vocal tone, timbre, breathiness, vibrato, energy, or spoken cadence.',
            },
            musical_characteristics: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            creative_recommendations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            limitations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Explicit limitations, uncertainties, noise issues, or unmeasurable metrics.',
            },
          },
          required: [
            'recording_type',
            'audio_summary',
            'transcription',
            'lyrics',
            'melody',
            'rhythm',
            'mood',
            'possible_genres',
            'possible_instruments',
            'vocal_characteristics',
            'musical_characteristics',
            'creative_recommendations',
            'limitations',
          ],
        },
      },
    })
  );

  params.onStage?.('extracting', 'Validating structured musical characteristics...');

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new GeminiServiceError('Gemini returned an empty response for audio analysis.', 502);
  }

  let parsed: Partial<StructuredAudioAnalysis>;
  try {
    parsed = JSON.parse(rawText) as Partial<StructuredAudioAnalysis>;
  } catch {
    throw new GeminiServiceError('Gemini returned malformed JSON during audio analysis.', 502);
  }

  const recordingType = sanitizeRecordingType(parsed.recording_type);
  const limitations = sanitizeStringArray(parsed.limitations);

  // Enforce strict grounding rules between AI output and DSP measurements:
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

  // If DSP had neither reliable key nor reliable BPM, ensure limitations documents any nulls cleanly
  if (estimatedBpm === null && !limitations.some((l) => l.toLowerCase().includes('tempo') || l.toLowerCase().includes('bpm') || l.toLowerCase().includes('pulse'))) {
    limitations.push('No steady rhythmic pulse detected; BPM was left unmeasured rather than guessed.');
  }
  if (estimatedKey === null && (parsed.melody?.detected ?? false) && !limitations.some((l) => l.toLowerCase().includes('key') || l.toLowerCase().includes('tonal'))) {
    limitations.push('Tonal center/key was ambiguous across this short take; key left unconfirmed.');
  }

  // Ground pitch observations with real DSP pitch span when melody is detected
  const pitchObservations = sanitizeStringArray(parsed.melody?.pitch_observations);
  if ((parsed.melody?.detected ?? false) && dsp.minPitchHz && dsp.maxPitchHz) {
    const dspObs = `Measured vocal/melodic pitch span: ${dsp.minPitchHz} Hz – ${dsp.maxPitchHz} Hz (~${dsp.pitchRangeSemitones} semitones).`;
    if (!pitchObservations.some((o) => o.includes('Hz'))) {
      pitchObservations.unshift(dspObs);
    }
  }

  const finalTranscript =
    (typeof parsed.transcription === 'string' ? parsed.transcription.trim() : '') ||
    dedicatedTranscript ||
    '';

  const finalLyrics =
    recordingType === 'humming' || recordingType === 'instrumental'
      ? ''
      : typeof parsed.lyrics === 'string'
        ? parsed.lyrics.trim()
        : '';

  return {
    recording_type: recordingType,
    analysis_mode: analysisMode,
    audio_summary:
      (typeof parsed.audio_summary === 'string' ? parsed.audio_summary.trim() : '') ||
      `Processed ${dsp.durationSeconds.toFixed(1)}s ${detectedContainer.format.toUpperCase()} audio recording.`,
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
    if (SUPPORTED_GEMINI_AUDIO_MIME_TYPES.has(baseMime) && params.audioBuffer.length <= 24 * 1024 * 1024) {
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

  const response = await runWithModelFallback('Develop idea', (model) =>
    ai.models.generateContent({
      model,
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
    throw new GeminiServiceError('Gemini returned an empty response while developing the composition.', 502);
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

  const response = await runWithModelFallback('Lyric assist', (model) =>
    ai.models.generateContent({
      model,
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
    throw new GeminiServiceError('Gemini returned an empty response for lyric assistance.', 502);
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

  const response = await runWithModelFallback('Music assistant', (model) =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction:
          'You are SoundScribe AI Music Assistant, an insightful studio producer, arranger, and songwriting partner. Give concrete, musical, grounded advice (chord voicings, rhythmic feels, lyric phrasing, arrangement dynamics, and production ideas). Keep formatting clean and scannable.',
      },
    })
  );

  const reply = (response.text ?? '').trim();
  if (!reply) {
    throw new GeminiServiceError('Gemini returned an empty response.', 502);
  }
  return reply;
}
