import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);

export interface DetectedContainer {
  format: string;
  mimeType: string;
}

export interface DspAudioFeatures {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  codecName: string;
  rmsLevel: number;
  peakLevel: number;
  activeRatio: number;
  isSilent: boolean;
  voicedFrameCount: number;
  voicedRatio: number;
  pitchRangeSemitones: number;
  minPitchHz: number | null;
  maxPitchHz: number | null;
  medianPitchHz: number | null;
  contourDescription: string;
  repeatingPhraseDetected: boolean;
  estimatedKey: string | null;
  keyConfidence: number | null;
  estimatedBpm: number | null;
  tempoConfidence: number | null;
  onsetDensityPerSec: number;
}

export interface ProcessedAudioResult {
  detectedContainer: DetectedContainer;
  geminiBuffer: Buffer;
  geminiMimeType: string;
  dsp: DspAudioFeatures;
}

export function detectAudioSignature(buf: Buffer, fallbackMime?: string): DetectedContainer | null {
  if (buf.length < 16) return null;

  // WAV: "RIFF" .... "WAVE"
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return { format: 'wav', mimeType: 'audio/wav' };
  }

  // WebM / Matroska EBML header: 1A 45 DF A3
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { format: 'webm', mimeType: 'audio/webm' };
  }

  // OGG: "OggS"
  if (buf.subarray(0, 4).toString('ascii') === 'OggS') {
    return { format: 'ogg', mimeType: 'audio/ogg' };
  }

  // FLAC: "fLaC"
  if (buf.subarray(0, 4).toString('ascii') === 'fLaC') {
    return { format: 'flac', mimeType: 'audio/flac' };
  }

  // MP3 with ID3 tag or MPEG frame sync
  if (
    buf.subarray(0, 3).toString('ascii') === 'ID3' ||
    (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
  ) {
    // Distinguish ADTS AAC (0xFF 0xF1 / 0xFF 0xF9) vs MP3
    if (buf[0] === 0xff && (buf[1] === 0xf1 || buf[1] === 0xf9)) {
      return { format: 'aac', mimeType: 'audio/aac' };
    }
    return { format: 'mp3', mimeType: 'audio/mpeg' };
  }

  // MP4 / M4A: "ftyp" at offset 4
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    return { format: 'mp4', mimeType: 'audio/mp4' };
  }

  // AIFF: "FORM" .... "AIFF"
  if (
    buf.subarray(0, 4).toString('ascii') === 'FORM' &&
    buf.subarray(8, 12).toString('ascii') === 'AIFF'
  ) {
    return { format: 'aiff', mimeType: 'audio/aiff' };
  }

  // Allow valid declared audio mime fallback if ffprobe confirms audio stream
  if (fallbackMime && fallbackMime.toLowerCase().startsWith('audio/')) {
    return {
      format: fallbackMime.split('/')[1]?.split(';')[0] || 'audio',
      mimeType: fallbackMime.split(';')[0].trim().toLowerCase(),
    };
  }

  return null;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Krumhansl-Schmuckler key profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = a.length;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : 0;
}

function yinPitchDetect(
  frame: Float32Array,
  sampleRate: number,
  minHz = 70,
  maxHz = 850,
  threshold = 0.16
): { hz: number; clarity: number } | null {
  const halfLen = Math.floor(frame.length / 2);
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxTau = Math.min(halfLen - 2, Math.floor(sampleRate / minHz));
  if (maxTau <= minTau) return null;

  const diff = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < halfLen; i++) {
      const d = frame[i] - frame[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Cumulative mean normalized difference function (CMNDF)
  const cmndf = new Float32Array(maxTau + 1);
  cmndf[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    runningSum += diff[tau];
    cmndf[tau] = runningSum > 0 ? (diff[tau] * tau) / runningSum : 1;
  }

  // Find first valley below threshold
  let tauEstimate = -1;
  for (let tau = minTau; tau < maxTau; tau++) {
    if (cmndf[tau] < threshold) {
      while (tau + 1 < maxTau && cmndf[tau + 1] < cmndf[tau]) {
        tau++;
      }
      tauEstimate = tau;
      break;
    }
  }

  if (tauEstimate === -1) return null;

  // Parabolic interpolation around tauEstimate
  let betterTau = tauEstimate;
  if (tauEstimate > 1 && tauEstimate < maxTau) {
    const s0 = cmndf[tauEstimate - 1];
    const s1 = cmndf[tauEstimate];
    const s2 = cmndf[tauEstimate + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denom) > 1e-6) {
      betterTau = tauEstimate + (s2 - s0) / denom;
    }
  }

  const hz = sampleRate / betterTau;
  if (!Number.isFinite(hz) || hz < minHz || hz > maxHz) return null;
  const clarity = Math.max(0, Math.min(1, 1 - cmndf[tauEstimate]));
  return { hz, clarity };
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function extractDspFromPcm16(wavBuffer: Buffer, codecName: string, reportedDuration: number): DspAudioFeatures {
  // Parse WAV data chunk reliably
  let dataOffset = 44;
  let dataSize = wavBuffer.length - 44;
  let sampleRate = 16000;
  let channels = 1;

  if (wavBuffer.length >= 44 && wavBuffer.subarray(0, 4).toString('ascii') === 'RIFF') {
    let pos = 12;
    while (pos + 8 <= wavBuffer.length) {
      const chunkId = wavBuffer.subarray(pos, pos + 4).toString('ascii');
      const chunkSize = wavBuffer.readUInt32LE(pos + 4);
      if (chunkId === 'fmt ' && pos + 24 <= wavBuffer.length) {
        channels = wavBuffer.readUInt16LE(pos + 10);
        sampleRate = wavBuffer.readUInt32LE(pos + 12);
      } else if (chunkId === 'data') {
        dataOffset = pos + 8;
        dataSize = Math.min(chunkSize, wavBuffer.length - dataOffset);
        break;
      }
      pos += 8 + chunkSize + (chunkSize % 2);
    }
  }

  const totalSamples = Math.max(0, Math.floor(dataSize / 2));
  const samples = new Float32Array(totalSamples);
  let sumSq = 0;
  let peak = 0;

  for (let i = 0; i < totalSamples; i++) {
    const val = wavBuffer.readInt16LE(dataOffset + i * 2) / 32768;
    samples[i] = val;
    sumSq += val * val;
    const abs = Math.abs(val);
    if (abs > peak) peak = abs;
  }

  const durationSeconds = totalSamples > 0 ? totalSamples / sampleRate : reportedDuration;
  const rmsLevel = totalSamples > 0 ? Math.sqrt(sumSq / totalSamples) : 0;
  const isSilent = peak < 0.004 || rmsLevel < 0.0012;

  const frameSize = 2048;
  const hopSize = 512; // ~32ms at 16kHz
  const frameEnergyThreshold = Math.max(0.006, rmsLevel * 0.25);

  let activeFrames = 0;
  let totalFrames = 0;
  const pitchFrames: Array<{ time: number; hz: number; midi: number; clarity: number }> = [];
  const energies: number[] = [];
  const onsetEnvelope: number[] = [];
  let prevLogEnergy = -10;

  const frameBuf = new Float32Array(frameSize);
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    totalFrames++;
    let fSum = 0;
    for (let i = 0; i < frameSize; i++) {
      const s = samples[start + i];
      frameBuf[i] = s;
      fSum += s * s;
    }
    const fRms = Math.sqrt(fSum / frameSize);
    energies.push(fRms);

    const logE = Math.log10(fRms + 1e-6);
    const flux = Math.max(0, logE - prevLogEnergy);
    onsetEnvelope.push(flux);
    prevLogEnergy = logE;

    if (fRms >= frameEnergyThreshold) {
      activeFrames++;
      const pitch = yinPitchDetect(frameBuf, sampleRate);
      if (pitch) {
        const midi = 69 + 12 * Math.log2(pitch.hz / 440);
        pitchFrames.push({
          time: start / sampleRate,
          hz: pitch.hz,
          midi,
          clarity: pitch.clarity,
        });
      }
    }
  }

  const activeRatio = totalFrames > 0 ? activeFrames / totalFrames : 0;
  const voicedRatio = activeFrames > 0 ? pitchFrames.length / activeFrames : 0;

  // Smooth MIDI sequence with 5-frame median filter to eliminate single-frame octave jumps
  const smoothedMidi: number[] = [];
  for (let i = 0; i < pitchFrames.length; i++) {
    const win = pitchFrames
      .slice(Math.max(0, i - 2), Math.min(pitchFrames.length, i + 3))
      .map((p) => p.midi);
    smoothedMidi.push(medianOf(win));
  }

  const smoothedHz = smoothedMidi.map((m) => 440 * Math.pow(2, (m - 69) / 12));
  const minPitchHz = smoothedHz.length ? Number(Math.min(...smoothedHz).toFixed(1)) : null;
  const maxPitchHz = smoothedHz.length ? Number(Math.max(...smoothedHz).toFixed(1)) : null;
  const medianPitchHz = smoothedHz.length ? Number(medianOf(smoothedHz).toFixed(1)) : null;
  const pitchRangeSemitones =
    smoothedMidi.length >= 2
      ? Number((Math.max(...smoothedMidi) - Math.min(...smoothedMidi)).toFixed(1))
      : 0;

  // Melodic contour analysis
  let contourDescription = 'No stable melodic pitch contour detected.';
  let repeatingPhraseDetected = false;

  if (smoothedMidi.length >= 6) {
    const firstThird = medianOf(smoothedMidi.slice(0, Math.floor(smoothedMidi.length / 3)));
    const middleThird = medianOf(
      smoothedMidi.slice(
        Math.floor(smoothedMidi.length / 3),
        Math.floor((2 * smoothedMidi.length) / 3)
      )
    );
    const lastThird = medianOf(smoothedMidi.slice(Math.floor((2 * smoothedMidi.length) / 3)));

    const netDelta = lastThird - firstThird;
    const midLift = middleThird - (firstThird + lastThird) / 2;

    if (pitchRangeSemitones < 1.5) {
      contourDescription = 'Steady / near-monotone pitch center with minimal interval movement.';
    } else if (midLift > 2.0 && Math.abs(netDelta) < 2.5) {
      contourDescription = `Arch-shaped melodic contour (rises ~${midLift.toFixed(1)} semitones mid-phrase before resolving back down).`;
    } else if (midLift < -2.0 && Math.abs(netDelta) < 2.5) {
      contourDescription = `Valley-shaped melodic contour (dips mid-phrase before rising back toward the starting register).`;
    } else if (netDelta >= 2.0) {
      contourDescription = `Generally ascending melodic movement (+${netDelta.toFixed(1)} semitones across ${pitchRangeSemitones} st total span).`;
    } else if (netDelta <= -2.0) {
      contourDescription = `Generally descending melodic movement (${netDelta.toFixed(1)} semitones across ${pitchRangeSemitones} st total span).`;
    } else {
      contourDescription = `Undulating / wave-like melodic contour spanning ${pitchRangeSemitones} semitones.`;
    }

    // Quantize to semitone sequence of stable steps to look for repeating 3-step contour motifs
    const quantizedSteps: number[] = [];
    for (const m of smoothedMidi) {
      const rounded = Math.round(m);
      if (quantizedSteps.length === 0 || quantizedSteps[quantizedSteps.length - 1] !== rounded) {
        quantizedSteps.push(rounded);
      }
    }
    if (quantizedSteps.length >= 7) {
      const seenMotifs = new Set<string>();
      for (let i = 0; i <= quantizedSteps.length - 4; i++) {
        const intervals = [
          quantizedSteps[i + 1] - quantizedSteps[i],
          quantizedSteps[i + 2] - quantizedSteps[i + 1],
          quantizedSteps[i + 3] - quantizedSteps[i + 2],
        ].join(',');
        if (seenMotifs.has(intervals) && intervals !== '0,0,0') {
          repeatingPhraseDetected = true;
          break;
        }
        seenMotifs.add(intervals);
      }
    }
  }

  // Krumhansl-Schmuckler tonal center estimation (only if sufficient melodic pitching)
  let estimatedKey: string | null = null;
  let keyConfidence: number | null = null;

  if (smoothedMidi.length >= 10 && pitchRangeSemitones >= 2.0) {
    const chroma = new Array(12).fill(0);
    for (let i = 0; i < smoothedMidi.length; i++) {
      const pc = ((Math.round(smoothedMidi[i]) % 12) + 12) % 12;
      chroma[pc] += pitchFrames[i].clarity;
    }

    let bestScore = -1;
    let bestKeyName = '';
    for (let root = 0; root < 12; root++) {
      const rotated = chroma.map((_, idx) => chroma[(idx + root) % 12]);
      const majScore = pearsonCorrelation(rotated, MAJOR_PROFILE);
      if (majScore > bestScore) {
        bestScore = majScore;
        bestKeyName = `${NOTE_NAMES[root]} major`;
      }
      const minScore = pearsonCorrelation(rotated, MINOR_PROFILE);
      if (minScore > bestScore) {
        bestScore = minScore;
        bestKeyName = `${NOTE_NAMES[root]} minor`;
      }
    }

    if (bestScore >= 0.72) {
      estimatedKey = bestKeyName;
      keyConfidence = Number(bestScore.toFixed(2));
    }
  }

  // Onset & Tempo Estimation via Onset Autocorrelation
  const meanOnset =
    onsetEnvelope.length > 0
      ? onsetEnvelope.reduce((a, b) => a + b, 0) / onsetEnvelope.length
      : 0;
  let onsetCount = 0;
  for (let i = 1; i < onsetEnvelope.length - 1; i++) {
    if (
      onsetEnvelope[i] > meanOnset * 2.2 &&
      onsetEnvelope[i] > 0.14 &&
      onsetEnvelope[i] >= onsetEnvelope[i - 1] &&
      onsetEnvelope[i] >= onsetEnvelope[i + 1]
    ) {
      onsetCount++;
    }
  }
  const onsetDensityPerSec = durationSeconds > 0 ? Number((onsetCount / durationSeconds).toFixed(2)) : 0;

  let estimatedBpm: number | null = null;
  let tempoConfidence: number | null = null;

  if (durationSeconds >= 3.5 && onsetCount >= 4 && onsetEnvelope.length > 20) {
    const hopSec = hopSize / sampleRate;
    const minLag = Math.floor(60 / 170 / hopSec); // 170 BPM
    const maxLag = Math.ceil(60 / 60 / hopSec); // 60 BPM

    const centered = onsetEnvelope.map((v) => Math.max(0, v - meanOnset));
    let zeroLag = 0;
    for (const v of centered) zeroLag += v * v;

    if (zeroLag > 0) {
      let bestLag = -1;
      let bestCorr = 0;
      for (let lag = minLag; lag <= maxLag && lag < centered.length / 2; lag++) {
        let sum = 0;
        for (let i = 0; i + lag < centered.length; i++) {
          sum += centered[i] * centered[i + lag];
        }
        const normCorr = sum / zeroLag;
        if (normCorr > bestCorr) {
          bestCorr = normCorr;
          bestLag = lag;
        }
      }

      if (bestLag > 0 && bestCorr >= 0.35) {
        estimatedBpm = Math.round(60 / (bestLag * hopSec));
        tempoConfidence = Number(Math.min(1, bestCorr).toFixed(2));
      }
    }
  }

  return {
    durationSeconds: Number(durationSeconds.toFixed(2)),
    sampleRate,
    channels,
    codecName,
    rmsLevel: Number(rmsLevel.toFixed(4)),
    peakLevel: Number(peak.toFixed(4)),
    activeRatio: Number(activeRatio.toFixed(2)),
    isSilent,
    voicedFrameCount: pitchFrames.length,
    voicedRatio: Number(voicedRatio.toFixed(2)),
    pitchRangeSemitones,
    minPitchHz,
    maxPitchHz,
    medianPitchHz,
    contourDescription,
    repeatingPhraseDetected,
    estimatedKey,
    keyConfidence,
    estimatedBpm,
    tempoConfidence,
    onsetDensityPerSec,
  };
}

export async function processAndValidateAudio(params: {
  buffer: Buffer;
  declaredMimeType?: string;
  originalName?: string;
}): Promise<ProcessedAudioResult> {
  if (!params.buffer || params.buffer.length < 128) {
    throw new Error('Audio recording is empty or too short (less than 128 bytes).');
  }

  const maxUploadBytes = 50 * 1024 * 1024;
  if (params.buffer.length > maxUploadBytes) {
    throw new Error(
      `Audio file is ${(params.buffer.length / (1024 * 1024)).toFixed(1)} MB, exceeding the 50 MB processing limit.`
    );
  }

  const detected = detectAudioSignature(params.buffer, params.declaredMimeType);
  if (!detected) {
    throw new Error(
      'Unrecognized or corrupted audio file signature. Supported formats: WebM, WAV, MP3, M4A/MP4, OGG, AAC, FLAC.'
    );
  }

  const jobId = crypto.randomUUID();
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `ss-in-${jobId}.${detected.format}`);
  const wavPath = path.join(tmpDir, `ss-dsp-${jobId}.wav`);
  const mp3Path = path.join(tmpDir, `ss-ai-${jobId}.mp3`);

  try {
    await fs.writeFile(inputPath, params.buffer);

    // 1. Probe container & verify valid audio stream
    let probeJson: {
      streams?: Array<{ codec_type?: string; codec_name?: string; duration?: string }>;
      format?: { duration?: string; format_name?: string };
    };
    try {
      const { stdout } = await execFileAsync(
        'ffprobe',
        ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
        { timeout: 15000 }
      );
      probeJson = JSON.parse(stdout || '{}');
    } catch {
      throw new Error(
        'Audio container could not be parsed (corrupted or incomplete recording).'
      );
    }

    const audioStream = probeJson.streams?.find((s) => s.codec_type === 'audio');
    if (!audioStream) {
      throw new Error('No playable audio stream was found inside the submitted file.');
    }

    const reportedDuration = Number(
      audioStream.duration || probeJson.format?.duration || 0
    );

    // 2. Decode to 16kHz mono PCM16 WAV for accurate DSP & universal AI input
    try {
      await execFileAsync(
        'ffmpeg',
        ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wavPath],
        { timeout: 30000 }
      );
    } catch {
      throw new Error(
        'FFmpeg audio decoding failed. The file may be corrupted or use an unsupported codec.'
      );
    }

    const wavBuffer = await fs.readFile(wavPath);
    if (wavBuffer.length <= 44) {
      throw new Error('Decoded audio contains zero samples.');
    }

    const dsp = extractDspFromPcm16(
      wavBuffer,
      audioStream.codec_name || detected.format,
      reportedDuration
    );

    if (dsp.durationSeconds < 0.25) {
      throw new Error(
        `Recording is too short (${dsp.durationSeconds.toFixed(2)}s). Capture at least 0.5 seconds of audio.`
      );
    }

    if (dsp.isSilent) {
      throw new Error(
        'Recording appears completely silent. Check that your microphone input is unmuted and capturing sound.'
      );
    }

    // 3. Prepare clean AI payload (< 24 MB)
    // Prefer standardized 16kHz mono WAV when <= 18MB; otherwise encode clean 96kbps MP3
    let geminiBuffer = wavBuffer;
    let geminiMimeType = 'audio/wav';

    if (wavBuffer.length > 18 * 1024 * 1024) {
      await execFileAsync(
        'ffmpeg',
        ['-y', '-i', wavPath, '-c:a', 'libmp3lame', '-b:a', '96k', mp3Path],
        { timeout: 30000 }
      );
      geminiBuffer = await fs.readFile(mp3Path);
      geminiMimeType = 'audio/mpeg';
    }

    if (geminiBuffer.length > 25 * 1024 * 1024) {
      throw new Error(
        'Converted audio still exceeds the 25 MB Gemini audio limit. Try trimming or recording a shorter section.'
      );
    }

    return {
      detectedContainer: detected,
      geminiBuffer,
      geminiMimeType,
      dsp,
    };
  } finally {
    await Promise.allSettled([
      fs.unlink(inputPath),
      fs.unlink(wavPath),
      fs.unlink(mp3Path),
    ]);
  }
}
