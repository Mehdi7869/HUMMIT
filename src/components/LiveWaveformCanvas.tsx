import { useEffect, useRef } from 'react';

interface LiveWaveformCanvasProps {
  analyser: AnalyserNode | null;
  isRecording: boolean;
  isPaused: boolean;
  height?: number;
}

export function LiveWaveformCanvas({
  analyser,
  isRecording,
  isPaused,
  height = 140,
}: LiveWaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const width = canvas.clientWidth || 600;
      ctx.clearRect(0, 0, width, height);

      // Subtle studio center reference line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      if (analyser && isRecording && !isPaused) {
        const bufferLength = analyser.fftSize;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(dataArray);

        // Calculate RMS amplitude for scrolling bar history
        let sumSquares = 0;
        for (let i = 0; i < bufferLength; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / bufferLength);
        const level = Math.min(1, rms * 3.4);

        const maxBars = Math.floor(width / 5);
        historyRef.current.push(level);
        if (historyRef.current.length > maxBars) {
          historyRef.current.shift();
        }

        // Draw scrolling amplitude bars
        const bars = historyRef.current;
        const startX = width - bars.length * 5;
        for (let i = 0; i < bars.length; i++) {
          const amp = Math.max(0.05, bars[i]);
          const barH = amp * (height * 0.78);
          const x = startX + i * 5;
          const y = (height - barH) / 2;

          const grad = ctx.createLinearGradient(0, y, 0, y + barH);
          grad.addColorStop(0, '#06B6D4');
          grad.addColorStop(0.5, '#3B82F6');
          grad.addColorStop(1, '#8B5CF6');
          ctx.fillStyle = grad;
          ctx.fillRect(x, y, 3, barH);
        }

        // Overlay live instantaneous oscilloscope trace
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.72)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const sliceWidth = width / bufferLength;
        let x = 0;
        for (let i = 0; i < bufferLength; i += 4) {
          const v = dataArray[i] / 128.0;
          const y = (v * height) / 2;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth * 4;
        }
        ctx.stroke();
      } else if (isPaused && historyRef.current.length > 0) {
        const bars = historyRef.current;
        const startX = width - bars.length * 5;
        ctx.fillStyle = 'rgba(139, 92, 246, 0.45)';
        for (let i = 0; i < bars.length; i++) {
          const amp = Math.max(0.05, bars[i]);
          const barH = amp * (height * 0.78);
          ctx.fillRect(startX + i * 5, (height - barH) / 2, 3, barH);
        }
      } else {
        historyRef.current = [];
        // Idle quiet studio guide ticks
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        for (let x = 8; x < width; x += 12) {
          ctx.fillRect(x, height / 2 - 2, 2, 4);
        }
      }

      if (isRecording && !isPaused) {
        animId = requestAnimationFrame(draw);
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [analyser, isRecording, isPaused, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ height: `${height}px` }}
      className="w-full block rounded-lg bg-[#090A0E]"
      aria-label="Real-time microphone audio waveform"
    />
  );
}
