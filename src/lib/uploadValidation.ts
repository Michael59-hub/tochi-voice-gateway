import { fileTypeFromBuffer } from 'file-type';

const ALLOWED_MIME_TYPES = new Set([
  'audio/mp4', // M4A/AAC
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mpeg', //mp3
]);

const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB server maximum, per Step 3.5
const MAX_DURATION_SECONDS = 60;

export interface UploadValidationResult {
  ok: boolean;
  errorCode?: 'TOO_LONG' | 'BAD_FORMAT';
}

export async function validateAudioUpload(
  buffer: Buffer,
  claimedDurationSeconds: number,
): Promise<UploadValidationResult> {
  if (buffer.byteLength > MAX_AUDIO_BYTES) {
    return { ok: false, errorCode: 'TOO_LONG' };
  }

  if (claimedDurationSeconds > MAX_DURATION_SECONDS) {
    return { ok: false, errorCode: 'TOO_LONG' };
  }

  // Sniff actual file signature — do not trust the client-supplied MIME/extension.
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
    return { ok: false, errorCode: 'BAD_FORMAT' };
  }

  // TODO: verify actual audio duration against claimedDurationSeconds using a
  // real media-probing tool (ffprobe via child_process, or music-metadata) —
  // this currently trusts the client's stated duration, which Step 3.5 flags
  // as a gap ("do not trust the MIME header alone" extends to duration too).

  return { ok: true };
}