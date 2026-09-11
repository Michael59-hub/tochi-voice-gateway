import { spawn } from 'child_process';

// This file is deprecated for now
const CANONICAL_SAMPLE_RATE = 16000;
const CANONICAL_CHANNELS = 1;

/**
 * Transcodes arbitrary input audio (AAC/M4A, float-PCM WAV, OGG, etc.) into
 * canonical 16-bit signed PCM WAV, mono, 16kHz. This is the single point
 * where "whatever Android captured" becomes "whatever every provider
 * adapter can rely on" — per Step 4.3's canonicalization requirement.
 *
 * Throws if ffmpeg fails to decode the input (corrupt file, truly
 * unsupported codec, etc.) — callers should treat that as BAD_FORMAT.
 */
export function normalizeToCanonicalPcmWav(inputBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-acodec', 'pcm_s16le',
      '-ar', String(CANONICAL_SAMPLE_RATE),
      '-ac', String(CANONICAL_CHANNELS),
      '-f', 'wav',
      'pipe:1',
    ]);

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    ffmpeg.stdout.on('data', (chunk) => outChunks.push(chunk));
    ffmpeg.stderr.on('data', (chunk) => errChunks.push(chunk));

    ffmpeg.on('error', (err) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${Buffer.concat(errChunks).toString()}`));
        return;
      }
      resolve(Buffer.concat(outChunks));
    });

    ffmpeg.stdin.write(inputBuffer);
    ffmpeg.stdin.end();
  });
}