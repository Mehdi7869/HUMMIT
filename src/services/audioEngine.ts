export type MicStatus =
  | 'idle'
  | 'requesting'
  | 'ready'
  | 'recording'
  | 'paused'
  | 'denied'
  | 'unavailable'
  | 'error';

export type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped';

export interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

export interface CapturedAudio {
  blob: Blob;
  url: string;
  duration: number;
  mimeType: string;
  fileSize: number;
}

const SUPPORTED_UPLOAD_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.webm', '.ogg', '.aac', '.flac'];
const SUPPORTED_UPLOAD_MIMES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/webm',
  'audio/ogg',
  'audio/aac',
  'audio/flac',
]);

export const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB local/bucket cap
export const MAX_AI_AUDIO_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB Gemini direct input cap

export function pickSupportedRecordingMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

export function getExtensionFromMimeType(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase();
  if (base === 'audio/mpeg' || base === 'audio/mp3') return 'mp3';
  if (base === 'audio/wav' || base === 'audio/x-wav' || base === 'audio/wave') return 'wav';
  if (base === 'audio/mp4' || base === 'audio/m4a' || base === 'audio/x-m4a') return 'm4a';
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/aac') return 'aac';
  if (base === 'audio/flac') return 'flac';
  return 'webm';
}

export function validateAudioFile(file: File): { valid: boolean; error?: string; mimeType: string } {
  const lowerName = file.name.toLowerCase();
  const hasSupportedExt = SUPPORTED_UPLOAD_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const baseMime = (file.type || '').split(';')[0].trim().toLowerCase();
  const hasSupportedMime = baseMime ? SUPPORTED_UPLOAD_MIMES.has(baseMime) : false;

  if (!hasSupportedMime && !hasSupportedExt) {
    return {
      valid: false,
      error: `Unsupported file format (${file.type || file.name}). Please upload MP3, WAV, M4A, WebM, OGG, AAC, or FLAC audio.`,
      mimeType: file.type,
    };
  }

  if (file.size === 0) {
    return { valid: false, error: 'The selected audio file is empty (0 bytes).', mimeType: file.type };
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 50 MB maximum.`,
      mimeType: file.type,
    };
  }

  let resolvedMime = baseMime;
  if (!resolvedMime) {
    if (lowerName.endsWith('.mp3')) resolvedMime = 'audio/mpeg';
    else if (lowerName.endsWith('.wav')) resolvedMime = 'audio/wav';
    else if (lowerName.endsWith('.m4a')) resolvedMime = 'audio/mp4';
    else if (lowerName.endsWith('.ogg')) resolvedMime = 'audio/ogg';
    else if (lowerName.endsWith('.aac')) resolvedMime = 'audio/aac';
    else if (lowerName.endsWith('.flac')) resolvedMime = 'audio/flac';
    else resolvedMime = 'audio/webm';
  }

  return { valid: true, mimeType: resolvedMime };
}

export interface AudioProbeResult {
  duration: number;
  peakAmplitude: number | null;
}

export async function probeAudioBlob(blob: Blob): Promise<AudioProbeResult> {
  // Primary: Web Audio API decodeAudioData for exact sample duration and peak amplitude
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      try {
        const buffer = await blob.arrayBuffer();
        const decoded = await ctx.decodeAudioData(buffer.slice(0));
        let peak = 0;
        for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
          const data = decoded.getChannelData(ch);
          for (let i = 0; i < data.length; i += 4) {
            const abs = Math.abs(data[i]);
            if (abs > peak) peak = abs;
          }
        }
        if (Number.isFinite(decoded.duration) && decoded.duration > 0) {
          return { duration: decoded.duration, peakAmplitude: peak };
        }
      } finally {
        await ctx.close().catch(() => undefined);
      }
    }
  } catch {
    // Fallback to HTMLAudioElement below
  }

  // Fallback: HTMLAudioElement metadata probing
  const duration = await new Promise<number>((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const cleanup = () => {
      URL.revokeObjectURL(url);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      if (audio.duration === Infinity) {
        audio.currentTime = 1e6;
        audio.ontimeupdate = () => {
          audio.ontimeupdate = null;
          const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
          cleanup();
          resolve(dur);
        };
      } else {
        const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
        cleanup();
        resolve(dur);
      }
    };
    audio.onerror = () => {
      cleanup();
      resolve(0);
    };
    audio.src = url;
  });

  return { duration, peakAmplitude: null };
}

export async function extractAudioDuration(blob: Blob): Promise<number> {
  const probed = await probeAudioBlob(blob);
  return probed.duration;
}

export function validateAudioBlobForAnalysis(blob: Blob, mimeType?: string): void {
  if (!blob || blob.size < 256) {
    throw new Error('Audio recording is empty or incomplete (fewer than 256 bytes).');
  }
  if (blob.size > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error(
      `Audio file is ${(blob.size / (1024 * 1024)).toFixed(1)} MB, exceeding the 50 MB limit.`
    );
  }
  const effectiveMime = (blob.type || mimeType || '').split(';')[0].trim().toLowerCase();
  if (effectiveMime && !effectiveMime.startsWith('audio/') && effectiveMime !== 'video/webm') {
    throw new Error(`Unsupported MIME type "${effectiveMime}" for audio analysis.`);
  }
}

export async function listAudioInputDevices(): Promise<AudioDeviceOption[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, idx) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${idx + 1}`,
      }));
  } catch {
    return [];
  }
}

export class MicrophoneRecorder {
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private chunks: BlobPart[] = [];
  private mimeType = 'audio/webm';
  private startTimestamp = 0;
  private accumulatedMs = 0;
  private state: RecordingState = 'idle';

  getState(): RecordingState {
    return this.state;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  getElapsedSeconds(): number {
    if (this.state === 'recording') {
      return (this.accumulatedMs + (performance.now() - this.startTimestamp)) / 1000;
    }
    return this.accumulatedMs / 1000;
  }

  async requestAndStart(deviceId?: string): Promise<void> {
    if (this.state === 'recording' || this.state === 'paused') {
      throw new Error('A recording session is already active.');
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error(
        'Audio recording is not supported in this browser environment. Please use a modern browser over HTTPS or upload an audio file.'
      );
    }

    const constraints: MediaStreamConstraints = {
      audio: deviceId
        ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true }
        : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new AudioCtx();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;
    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
    this.sourceNode.connect(this.analyser);

    const preferredMime = pickSupportedRecordingMimeType();
    this.chunks = [];
    this.mediaRecorder = preferredMime
      ? new MediaRecorder(this.stream, { mimeType: preferredMime })
      : new MediaRecorder(this.stream);

    this.mimeType = this.mediaRecorder.mimeType || preferredMime || 'audio/webm';

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.accumulatedMs = 0;
    this.startTimestamp = performance.now();
    this.state = 'recording';
    this.mediaRecorder.start(200);
  }

  pause(): void {
    if (this.state !== 'recording' || !this.mediaRecorder) return;
    if (this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
      this.accumulatedMs += performance.now() - this.startTimestamp;
      this.state = 'paused';
    }
  }

  resume(): void {
    if (this.state !== 'paused' || !this.mediaRecorder) return;
    if (this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
      this.startTimestamp = performance.now();
      this.state = 'recording';
    }
  }

  async stop(): Promise<CapturedAudio> {
    if (!this.mediaRecorder || (this.state !== 'recording' && this.state !== 'paused')) {
      throw new Error('No active recording to stop.');
    }

    if (this.state === 'recording') {
      this.accumulatedMs += performance.now() - this.startTimestamp;
    }

    const recorder = this.mediaRecorder;
    const rawDuration = this.accumulatedMs / 1000;

    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        const finalBlob = new Blob(this.chunks, { type: this.mimeType || 'audio/webm' });
        resolve(finalBlob);
      };
      recorder.onerror = () => {
        reject(new Error('MediaRecorder encountered an error while finalizing the recording.'));
      };
      recorder.stop();
    });

    this.cleanupStream();
    this.state = 'stopped';

    if (!blob || blob.size < 256) {
      throw new Error('No audio data was captured. Check that your microphone is connected and recording.');
    }

    const probed = await probeAudioBlob(blob);
    const duration = probed.duration > 0.1 ? probed.duration : rawDuration;

    if (duration < 0.25) {
      throw new Error('Recording was too short (< 0.25s). Please record a slightly longer musical phrase.');
    }

    if (probed.peakAmplitude !== null && probed.peakAmplitude < 0.001) {
      throw new Error('Captured audio is completely silent. Ensure your microphone is unmuted and try again.');
    }

    const url = URL.createObjectURL(blob);

    return {
      blob,
      url,
      duration,
      mimeType: blob.type || this.mimeType || 'audio/webm',
      fileSize: blob.size,
    };
  }

  discard(): void {
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    } catch {
      // ignore stop errors on discard
    }
    this.cleanupStream();
    this.chunks = [];
    this.accumulatedMs = 0;
    this.state = 'idle';
  }

  private cleanupStream(): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // ignore
      }
      this.sourceNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
    this.analyser = null;
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
  }
}

export function mapMicError(err: unknown): { status: MicStatus; message: string } {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return {
        status: 'denied',
        message:
          'Microphone permission was denied. Enable microphone access in your browser site settings and try again.',
      };
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return {
        status: 'unavailable',
        message:
          'No microphone was detected on this device. Connect an audio input or upload an audio file instead.',
      };
    }
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      return {
        status: 'error',
        message:
          'Your microphone is currently in use by another application. Close other audio apps and retry.',
      };
    }
  }
  return {
    status: 'error',
    message: err instanceof Error ? err.message : 'Unable to access microphone.',
  };
}
