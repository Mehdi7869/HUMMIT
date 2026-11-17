import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { processAndValidateAudio } from './server/audioProcessor.ts';
import {
  analyzeRecordingWithGemini,
  assistLyricsWithGemini,
  chatMusicAssistantWithGemini,
  developIdeaWithGemini,
  GeminiServiceError,
} from './server/geminiService.ts';
import {
  analyzeRecordingWithGroq,
  transcribeWithGroqWhisper,
  developIdeaWithGroq,
  assistLyricsWithGroq,
  chatMusicAssistantWithGroq,
  checkGroqAudioModelStatus,
  getGroqAudioModel,
  isGroqConfigured,
  GroqServiceError,
} from './server/groqService.ts';
import type { AnalysisMode, AnalysisEngine, StructuredAudioAnalysis } from './src/types/soundscribe.ts';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB upload cap; audioProcessor validates & normalizes to <25 MB for Gemini
  },
});

// Optional server-side Supabase JWT verification when Supabase is configured
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

async function verifyOptionalSupabaseToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!supabaseUrl || !supabaseAnonKey || !authHeader?.startsWith('Bearer ')) {
    return next();
  }

  try {
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token || token === 'local-session') {
      return next();
    }
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: 'Invalid or expired authentication session.' });
    }
    (req as Request & { userId?: string }).userId = data.user.id;
    return next();
  } catch {
    return res.status(401).json({ error: 'Authentication verification failed.' });
  }
}

function resolveHttpErrorStatus(error: unknown): { status: number; message: string } {
  if (error instanceof GeminiServiceError) {
    return { status: error.status, message: error.message };
  }
  if (error instanceof GroqServiceError) {
    return { status: error.status, message: error.message };
  }
  const message =
    error instanceof Error ? error.message : 'Failed to process request.';

  const lower = message.toLowerCase();
  if (
    lower.includes('empty') ||
    lower.includes('too short') ||
    lower.includes('silent') ||
    lower.includes('unrecognized') ||
    lower.includes('corrupted') ||
    lower.includes('unsupported') ||
    lower.includes('no playable audio') ||
    lower.includes('zero samples') ||
    lower.includes('ffmpeg') ||
    lower.includes('exceeding') ||
    lower.includes('exceeds')
  ) {
    return { status: 400, message };
  }
  if (lower.includes('gemini_api_key') || lower.includes('groq_api_key')) {
    return { status: 503, message };
  }
  return { status: 500, message };
}

app.get('/api/health', async (_req: Request, res: Response) => {
  const groqReady = isGroqConfigured();
  const groqModel = getGroqAudioModel();
  const groqStatus = await checkGroqAudioModelStatus(groqModel);

  res.json({
    ok: true,
    geminiConfigured: Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
    ),
    groqConfigured: groqReady,
    groqModel,
    groqModelStatus: groqStatus,
    supabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  });
});

app.get('/api/groq/model-status', async (_req: Request, res: Response) => {
  try {
    const status = await checkGroqAudioModelStatus();
    return res.json(status);
  } catch (error) {
    const { status, message } = resolveHttpErrorStatus(error);
    return res.status(status).json({ error: message });
  }
});

app.post(
  '/api/ai/analyze-recording',
  verifyOptionalSupabaseToken,
  upload.single('audio'),
  async (req: Request, res: Response) => {
    const isStreaming =
      req.query.stream === '1' ||
      req.headers.accept?.includes('application/x-ndjson') ||
      false;

    const emitStage = (stage: string, detail: string) => {
      if (!isStreaming || res.writableEnded) return;
      res.write(`${JSON.stringify({ type: 'stage', stage, detail })}\n`);
    };

    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No audio file was provided for analysis.' });
      }

      const { title, notes, mimeType, analysisMode, engine } = req.body as {
        title?: string;
        notes?: string;
        duration?: string;
        mimeType?: string;
        analysisMode?: string;
        engine?: string;
      };

      const resolvedMode: AnalysisMode =
        analysisMode === 'humming' || analysisMode === 'voice' ? analysisMode : 'auto';

      const resolvedEngine: AnalysisEngine =
        engine === 'groq' || engine === 'gemini' ? engine : 'auto';

      if (isStreaming) {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
      }

      emitStage(
        'validating',
        `Inspecting ${(file.size / 1024).toFixed(0)} KB audio signature & stream headers...`
      );

      emitStage(
        'processing',
        'Decoding & normalizing audio waveform and extracting acoustic telemetry...'
      );

      const processedAudio = await processAndValidateAudio({
        buffer: file.buffer,
        declaredMimeType: mimeType || file.mimetype || 'audio/webm',
        originalName: file.originalname,
      });

      const groqReady = isGroqConfigured();
      const geminiReady = Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      );

      let analysis: StructuredAudioAnalysis;

      if (resolvedEngine === 'groq') {
        if (!groqReady) {
          throw new GroqServiceError(
            'GROQ_API_KEY is not configured on the server. Add your free Groq API key to .env to use Whisper audio analysis.',
            503
          );
        }
        analysis = await analyzeRecordingWithGroq({
          processedAudio,
          analysisMode: resolvedMode,
          title,
          notes,
          onStage: (stage, detail) => emitStage(stage, detail),
        });
        analysis.analysis_engine = 'groq';
        analysis.transcription_model = getGroqAudioModel();
      } else if (resolvedEngine === 'gemini') {
        if (!geminiReady) {
          throw new GeminiServiceError(
            'GEMINI_API_KEY is not configured on the server. Add your Gemini API key in .env or Settings.',
            503
          );
        }
        analysis = await analyzeRecordingWithGemini({
          processedAudio,
          analysisMode: resolvedMode,
          title,
          notes,
          onStage: (stage, detail) => emitStage(stage, detail),
        });
        analysis.analysis_engine = 'gemini';
      } else {
        // 'auto' mode
        if (groqReady && geminiReady) {
          // Hybrid mode: Groq Whisper-large-v3 provides high accuracy speech/lyric recognition, Gemini does multimodal reasoning
          emitStage('analyzing', `Transcribing audio with Groq Whisper (${getGroqAudioModel()})...`);
          let whisperText: string | null = null;
          let whisperLanguage: string | undefined = undefined;
          try {
            const whisperRes = await transcribeWithGroqWhisper({
              audioBuffer: processedAudio.geminiBuffer,
              mimeType: processedAudio.geminiMimeType,
              originalFilename: file.originalname,
              prompt: title,
            });
            if (whisperRes.isVerbal && whisperRes.text) {
              whisperText = whisperRes.text;
              whisperLanguage = whisperRes.language;
            }
          } catch (whisperErr) {
            console.warn('Groq whisper transcription in auto mode had error:', whisperErr);
          }

          analysis = await analyzeRecordingWithGemini({
            processedAudio,
            analysisMode: resolvedMode,
            title,
            notes,
            externalTranscript: whisperText,
            onStage: (stage, detail) => emitStage(stage, detail),
          });
          analysis.analysis_engine = whisperText ? 'hybrid' : 'gemini';
          if (whisperText) {
            analysis.transcription_model = getGroqAudioModel();
            analysis.detected_language = whisperLanguage;
          }
        } else if (groqReady) {
          // Groq is available, Gemini is not
          analysis = await analyzeRecordingWithGroq({
            processedAudio,
            analysisMode: resolvedMode,
            title,
            notes,
            onStage: (stage, detail) => emitStage(stage, detail),
          });
          analysis.analysis_engine = 'groq';
          analysis.transcription_model = getGroqAudioModel();
        } else if (geminiReady) {
          // Gemini is available, Groq is not
          analysis = await analyzeRecordingWithGemini({
            processedAudio,
            analysisMode: resolvedMode,
            title,
            notes,
            onStage: (stage, detail) => emitStage(stage, detail),
          });
          analysis.analysis_engine = 'gemini';
        } else {
          throw new GroqServiceError(
            'Neither GROQ_API_KEY nor GEMINI_API_KEY is configured. Add your free GROQ_API_KEY (for Whisper audio analysis) to .env to analyze recordings.',
            503
          );
        }
      }

      if (isStreaming) {
        res.write(`${JSON.stringify({ type: 'result', analysis })}\n`);
        return res.end();
      }

      return res.json({ analysis });
    } catch (error) {
      const { status, message } = resolveHttpErrorStatus(error);
      if (isStreaming && res.headersSent) {
        res.write(`${JSON.stringify({ type: 'error', status, error: message })}\n`);
        return res.end();
      }
      return res.status(status).json({ error: message });
    }
  }
);

app.post(
  '/api/ai/develop-idea',
  verifyOptionalSupabaseToken,
  upload.single('audio'),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      const body = req.body as {
        title?: string;
        notes?: string;
        transcript?: string;
        lyrics?: string;
        mood?: string;
        genre?: string;
        analysisSummary?: string;
        creativeFocus?: string;
        mimeType?: string;
      };

      if (!body.title && !file && !body.notes && !body.transcript) {
        return res.status(400).json({
          error: 'Provide a recording or creative notes to develop a composition plan.',
        });
      }

      const parseList = (val?: string): string[] => {
        if (!val) return [];
        try {
          const parsed = JSON.parse(val);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return val
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        }
      };

      let normalizedBuffer: Buffer | undefined;
      let normalizedMime: string | undefined;

      if (file) {
        try {
          const processed = await processAndValidateAudio({
            buffer: file.buffer,
            declaredMimeType: body.mimeType || file.mimetype,
            originalName: file.originalname,
          });
          normalizedBuffer = processed.geminiBuffer;
          normalizedMime = processed.geminiMimeType;
        } catch {
          // If audio normalization fails on develop-idea, continue using transcript/notes context rather than failing composition planning
          normalizedBuffer = undefined;
          normalizedMime = undefined;
        }
      }

      let plan;
      const geminiReady = Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      );

      if (geminiReady) {
        plan = await developIdeaWithGemini({
          audioBuffer: normalizedBuffer,
          mimeType: normalizedMime,
          title: body.title || 'Untitled Musical Idea',
          notes: body.notes,
          transcript: body.transcript,
          lyrics: body.lyrics,
          mood: parseList(body.mood),
          genre: parseList(body.genre),
          analysisSummary: body.analysisSummary,
          creativeFocus: body.creativeFocus,
        });
      } else if (isGroqConfigured()) {
        plan = await developIdeaWithGroq({
          title: body.title || 'Untitled Musical Idea',
          notes: body.notes,
          transcript: body.transcript,
          lyrics: body.lyrics,
          mood: parseList(body.mood),
          genre: parseList(body.genre),
          analysisSummary: body.analysisSummary,
          creativeFocus: body.creativeFocus,
        });
      } else {
        throw new GroqServiceError(
          'Neither GEMINI_API_KEY nor GROQ_API_KEY is configured. Set GROQ_API_KEY or GEMINI_API_KEY in .env.',
          503
        );
      }

      return res.json({ plan });
    } catch (error) {
      const { status, message } = resolveHttpErrorStatus(error);
      return res.status(status).json({ error: message });
    }
  }
);

app.post(
  '/api/ai/lyric-assist',
  verifyOptionalSupabaseToken,
  async (req: Request, res: Response) => {
    try {
      const { action, title, currentLyrics, selectedText, targetTone, mood, genre } = req.body as {
        action?: 'continue' | 'rewrite' | 'chorus' | 'rhymes' | 'tone';
        title?: string;
        currentLyrics?: string;
        selectedText?: string;
        targetTone?: string;
        mood?: string;
        genre?: string;
      };

      if (!action) {
        return res.status(400).json({ error: 'Lyric action is required.' });
      }

      let result;
      const geminiReady = Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      );

      if (geminiReady) {
        result = await assistLyricsWithGemini({
          action,
          title: title || 'Untitled Song',
          currentLyrics: currentLyrics || '',
          selectedText,
          targetTone,
          mood,
          genre,
        });
      } else if (isGroqConfigured()) {
        result = await assistLyricsWithGroq({
          action,
          title: title || 'Untitled Song',
          currentLyrics: currentLyrics || '',
          selectedText,
          targetTone,
          mood,
          genre,
        });
      } else {
        throw new GroqServiceError(
          'Neither GEMINI_API_KEY nor GROQ_API_KEY is configured. Set GROQ_API_KEY or GEMINI_API_KEY in .env.',
          503
        );
      }

      return res.json(result);
    } catch (error) {
      const { status, message } = resolveHttpErrorStatus(error);
      return res.status(status).json({ error: message });
    }
  }
);

app.post(
  '/api/ai/assistant',
  verifyOptionalSupabaseToken,
  async (req: Request, res: Response) => {
    try {
      const { messages, contextSummary } = req.body as {
        messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
        contextSummary?: string;
      };

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'Conversation messages are required.' });
      }

      let reply: string;
      const geminiReady = Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      );

      if (geminiReady) {
        reply = await chatMusicAssistantWithGemini({
          messages,
          contextSummary,
        });
      } else if (isGroqConfigured()) {
        reply = await chatMusicAssistantWithGroq({
          messages,
          contextSummary,
        });
      } else {
        throw new GroqServiceError(
          'Neither GEMINI_API_KEY nor GROQ_API_KEY is configured. Set GROQ_API_KEY or GEMINI_API_KEY in .env.',
          503
        );
      }

      return res.json({ reply });
    } catch (error) {
      const { status, message } = resolveHttpErrorStatus(error);
      return res.status(status).json({ error: message });
    }
  }
);

// Multer error handler
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'Uploaded audio exceeds the 50 MB limit.',
      });
    }
    return res.status(400).json({ error: err.message });
  }
  return next(err);
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SoundScribe server listening on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
export { app };
