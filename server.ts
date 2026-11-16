import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import {
  analyzeRecordingWithGemini,
  assistLyricsWithGemini,
  chatMusicAssistantWithGemini,
  developIdeaWithGemini,
} from './server/geminiService.ts';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 26 * 1024 * 1024, // 26MB buffer ceiling to gracefully report >25MB audio limit
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
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No audio file was provided for analysis.' });
      }

      const { title, notes, duration, mimeType } = req.body as {
        title?: string;
        notes?: string;
        duration?: string;
        mimeType?: string;
      };

      const analysis = await analyzeRecordingWithGemini({
        audioBuffer: file.buffer,
        mimeType: mimeType || file.mimetype || 'audio/webm',
        title,
        notes,
        duration: duration ? Number(duration) : undefined,
      });

      return res.json({ analysis });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to analyze recording with Gemini.';
      const status =
        message.includes('Unsupported audio') || message.includes('exceeds')
          ? 400
          : message.includes('GEMINI_API_KEY')
            ? 503
            : 500;
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

      const plan = await developIdeaWithGemini({
        audioBuffer: file?.buffer,
        mimeType: body.mimeType || file?.mimetype,
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
      const message =
        error instanceof Error ? error.message : 'Failed to develop composition idea.';
      return res.status(500).json({ error: message });
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
      const message =
        error instanceof Error ? error.message : 'Failed to generate lyric suggestions.';
      return res.status(500).json({ error: message });
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
      const message =
        error instanceof Error ? error.message : 'AI Music Assistant failed to respond.';
      return res.status(500).json({ error: message });
    }
  }
);

// Multer error handler
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'Uploaded audio exceeds the 25 MB limit for server-side AI audio analysis.',
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
