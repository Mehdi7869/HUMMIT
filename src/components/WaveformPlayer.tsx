import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Loader2, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react';
import { formatDuration } from '../utils/formatters';

interface WaveformPlayerProps {
  audioUrl?: string | null;
  resolveAudioUrl?: () => Promise<string>;
  initialDuration?: number;
  height?: number;
  compact?: boolean;
}

export function WaveformPlayer({
  audioUrl,
  resolveAudioUrl,
  initialDuration = 0,
  height = 72,
  compact = false,
}: WaveformPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const ownedObjectUrlRef = useRef<string | null>(null);

  const [resolvedUrl, setResolvedUrl] = useState<string | null>(audioUrl || null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResolvedUrl(audioUrl || null);
  }, [audioUrl]);

  // Lazily resolve audio URL if not passed directly
  useEffect(() => {
    let active = true;
    if (!audioUrl && resolveAudioUrl && !resolvedUrl) {
      setIsLoading(true);
      setError(null);
      resolveAudioUrl()
        .then((url) => {
          if (!active) {
            if (url.startsWith('blob:')) URL.revokeObjectURL(url);
            return;
          }
          if (url.startsWith('blob:')) ownedObjectUrlRef.current = url;
          setResolvedUrl(url);
        })
        .catch((err) => {
          if (active) {
            setError(err instanceof Error ? err.message : 'Could not load audio.');
          }
        })
        .finally(() => {
          if (active) setIsLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [audioUrl, resolveAudioUrl, resolvedUrl]);

  // Mount WaveSurfer instance when container + resolvedUrl exist
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !resolvedUrl) return;

    setIsLoading(true);
    setError(null);
    setIsPlaying(false);
    setCurrentTime(0);

    const ws = WaveSurfer.create({
      container,
      height,
      waveColor: '#3A4054',
      progressColor: '#8B5CF6',
      cursorColor: '#06B6D4',
      cursorWidth: 2,
      barWidth: compact ? 2 : 3,
      barGap: 2,
      barRadius: 2,
      normalize: true,
      url: resolvedUrl,
    });

    waveSurferRef.current = ws;

    ws.on('ready', (dur) => {
      setIsLoading(false);
      if (Number.isFinite(dur) && dur > 0) {
        setDuration(dur);
      }
    });

    ws.on('timeupdate', (time) => {
      setCurrentTime(time);
    });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));

    ws.on('error', (err) => {
      setIsLoading(false);
      setError(typeof err === 'string' ? err : 'Audio decoding failed in this browser.');
    });

    return () => {
      ws.destroy();
      waveSurferRef.current = null;
    };
  }, [resolvedUrl, height, compact]);

  // Clean up any locally created object URL on unmount
  useEffect(() => {
    return () => {
      if (ownedObjectUrlRef.current) {
        URL.revokeObjectURL(ownedObjectUrlRef.current);
        ownedObjectUrlRef.current = null;
      }
    };
  }, []);

  const togglePlay = () => {
    waveSurferRef.current?.playPause();
  };

  const seekBy = (deltaSeconds: number) => {
    const ws = waveSurferRef.current;
    if (!ws) return;
    const dur = ws.getDuration() || duration;
    if (dur <= 0) return;
    const next = Math.max(0, Math.min(dur, ws.getCurrentTime() + deltaSeconds));
    ws.setTime(next);
  };

  const toggleMute = () => {
    const ws = waveSurferRef.current;
    if (!ws) return;
    const nextMuted = !isMuted;
    ws.setMuted(nextMuted);
    setIsMuted(nextMuted);
  };

  return (
    <div className="space-y-2.5">
      <div className="relative rounded-lg bg-[#090A0E] border border-white/[0.06] px-3 py-2">
        <div ref={containerRef} className="w-full" />
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#090A0E]/80 rounded-lg">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <Loader2 className="w-4 h-4 animate-spin text-[#8B5CF6]" />
              <span>Rendering waveform</span>
            </div>
          </div>
        )}
        {error && (
          <div className="py-3 text-xs text-rose-400 text-center">{error}</div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={togglePlay}
            disabled={isLoading || Boolean(error) || !resolvedUrl}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
            aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </button>

          {!compact && (
            <>
              <button
                type="button"
                onClick={() => seekBy(-5)}
                disabled={isLoading || !resolvedUrl}
                title="Rewind 5 seconds"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] disabled:opacity-40 text-slate-300 text-xs transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>5s</span>
              </button>
              <button
                type="button"
                onClick={() => seekBy(5)}
                disabled={isLoading || !resolvedUrl}
                title="Forward 5 seconds"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] disabled:opacity-40 text-slate-300 text-xs transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>5s</span>
              </button>
              <button
                type="button"
                onClick={toggleMute}
                disabled={isLoading || !resolvedUrl}
                aria-label={isMuted ? 'Unmute' : 'Mute'}
                className="p-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 transition-colors"
              >
                {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </>
          )}
        </div>

        <div className="font-mono-tabular text-xs text-slate-400 whitespace-nowrap shrink-0">
          <span className="text-slate-200">{formatDuration(currentTime)}</span>
          <span className="mx-1 text-slate-600">/</span>
          <span>{formatDuration(duration)}</span>
        </div>
      </div>
    </div>
  );
}
