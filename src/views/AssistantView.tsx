import { FormEvent, useState } from 'react';
import { Bot, Copy, Loader2, Send, Trash2 } from 'lucide-react';
import { Analysis, ChatMessage, Lyrics, Project, Recording } from '../types/soundscribe';
import { requestAssistantChat } from '../services/aiClient';

interface AssistantViewProps {
  recordings: Recording[];
  analyses: Analysis[];
  projects: Project[];
  lyrics: Lyrics[];
}

const STARTER_PROMPTS = [
  'Suggest 3 chord progression variations for a bittersweet acoustic verse transitioning into an uplifting chorus.',
  'How can I build arrangement tension between Verse 2 and a Bridge using dynamics rather than adding loud drums?',
  'Give me vocal layering and mic-double ideas to make an intimate chorus feel wide and cinematic.',
];

export function AssistantView({
  recordings,
  analyses,
  projects,
  lyrics,
}: AssistantViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedRecordingId, setSelectedRecordingId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedLyricsId, setSelectedLyricsId] = useState('');

  const buildContextSummary = (): string => {
    const parts: string[] = [];

    if (selectedProjectId) {
      const proj = projects.find((p) => p.id === selectedProjectId);
      if (proj) {
        parts.push(`Project: "${proj.name}" (${proj.status}) — ${proj.description}`);
      }
    }

    if (selectedRecordingId) {
      const rec = recordings.find((r) => r.id === selectedRecordingId);
      const ana = analyses.find((a) => a.recording_id === selectedRecordingId);
      if (rec) {
        parts.push(
          `Recording: "${rec.title}" (${Math.round(rec.duration)}s). Notes: ${rec.description || 'None'}.`
        );
      }
      if (ana) {
        parts.push(
          `Audio Analysis: Summary: ${ana.analysis_json.audio_summary}. Moods: ${ana.mood.join(', ')}. Genres: ${ana.genre.join(', ')}. Tempo: ${ana.estimated_bpm || 'Unmeasured'}. Transcript/Lyrics: ${ana.transcript || 'None'}`
        );
      }
    }

    if (selectedLyricsId) {
      const lyr = lyrics.find((l) => l.id === selectedLyricsId);
      if (lyr) {
        parts.push(`Lyric Sheet "${lyr.title}":\n${lyr.content}`);
      }
    }

    return parts.join('\n\n');
  };

  const sendMessage = async (textToSend?: string) => {
    const content = (textToSend ?? input).trim();
    if (!content || loading) return;

    setError(null);
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    if (!textToSend) setInput('');
    setLoading(true);

    try {
      const reply = await requestAssistantChat({
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        contextSummary: buildContextSummary() || undefined,
      });

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: reply,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assistant could not respond.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">AI Music Assistant</h1>
          <p className="text-sm text-slate-400">
            Discuss songwriting structure, harmony, arrangement, and production grounded in your
            saved studio ideas.
          </p>
        </div>

        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => setMessages([])}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs text-slate-300 self-start sm:self-auto"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Chat</span>
          </button>
        )}
      </div>

      {/* Context Selector Bar */}
      <div className="rounded-xl bg-[#12141C] border border-white/[0.08] p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <select
          aria-label="Attach recording context"
          value={selectedRecordingId}
          onChange={(e) => setSelectedRecordingId(e.target.value)}
          className="px-3 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-slate-200"
        >
          <option value="">Context: No Recording Attached</option>
          {recordings.map((r) => (
            <option key={r.id} value={r.id}>
              Recording: {r.title}
            </option>
          ))}
        </select>

        <select
          aria-label="Attach project context"
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="px-3 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-slate-200"
        >
          <option value="">Context: No Project Attached</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              Project: {p.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Attach lyrics context"
          value={selectedLyricsId}
          onChange={(e) => setSelectedLyricsId(e.target.value)}
          className="px-3 py-2 rounded-lg bg-[#090A0E] border border-white/[0.1] text-xs text-slate-200"
        >
          <option value="">Context: No Lyrics Attached</option>
          {lyrics.map((l) => (
            <option key={l.id} value={l.id}>
              Lyrics: {l.title}
            </option>
          ))}
        </select>
      </div>

      {/* Chat Workspace */}
      <div className="rounded-xl bg-[#12141C] border border-white/[0.08] flex flex-col min-h-[460px]">
        <div className="flex-1 p-5 space-y-4 overflow-y-auto max-h-[540px]">
          {messages.length === 0 ? (
            <div className="py-10 text-center space-y-5 max-w-2xl mx-auto">
              <div className="w-11 h-11 rounded-xl bg-[#8B5CF6]/15 text-[#A78BFA] flex items-center justify-center mx-auto">
                <Bot className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-base font-semibold text-white">
                  Studio Songwriting & Arrangement Collaborator
                </h2>
                <p className="text-xs text-slate-400">
                  Attach a recording, project, or lyric sheet above, or start with a musical
                  question below.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2.5 text-left">
                {STARTER_PROMPTS.map((prompt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => sendMessage(prompt)}
                    className="p-3 rounded-lg bg-[#090A0E] hover:bg-white/[0.04] border border-white/[0.08] text-xs text-slate-300 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed space-y-2 ${
                    m.role === 'user'
                      ? 'bg-[#8B5CF6] text-white'
                      : 'bg-[#090A0E] border border-white/[0.08] text-slate-200'
                  }`}
                >
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                    {m.content}
                  </pre>
                  {m.role === 'assistant' && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(m.content)}
                        className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-200"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {loading && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-[#06B6D4]" />
              <span>Thinking through musical ideas...</span>
            </div>
          )}
        </div>

        {error && (
          <div className="mx-5 mb-3 rounded-lg bg-rose-500/10 border border-rose-500/30 px-3.5 py-2 text-xs text-rose-300">
            {error}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="p-4 border-t border-white/[0.06] flex items-center gap-2.5"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about chord substitutions, arrangement dynamics, lyric rhythm..."
            className="flex-1 px-4 py-2.5 rounded-lg bg-[#090A0E] border border-white/[0.1] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#8B5CF6]"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="w-4 h-4" />
            <span>Send</span>
          </button>
        </form>
      </div>
    </div>
  );
}
