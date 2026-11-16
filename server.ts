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
import type { AnalysisMode } from './src/types/soundscribe.ts';

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
  if (lower.includes('gemini_api_key')) {
    return { status: 503, message };
  }
  return { status: 500, message };
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    geminiConfigured: Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
    ),
    supabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  });
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

      const { title, notes, mimeType, analysisMode } = req.body as {
        title?: string;
        notes?: string;
        duration?: string;
        mimeType?: string;
        analysisMode?: string;
      };

      const resolvedMode: AnalysisMode =
        analysisMode === 'humming' || analysisMode === 'voice' ? analysisMode : 'auto';

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

      const analysis = await analyzeRecordingWithGemini({
        processedAudio,
        analysisMode: resolvedMode,
        title,
        notes,
        onStage: (stage, detail) => emitStage(stage, detail),
      });

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

      const plan = await developIdeaWithGemini({
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

      const result = await assistLyricsWithGemini({
        action,
        title: title || 'Untitled Song',
        currentLyrics: currentLyrics || '',
        selectedText,
        targetTone,
        mood,
        genre,
      });

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

      const reply = await chatMusicAssistantWithGemini({
        messages,
        contextSummary,
      });

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

startServer();
