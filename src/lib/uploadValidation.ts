import { fileTypeFromBuffer } from 'file-type';
import { parseBuffer } from 'music-metadata';

const ALLOWED_MIME_TYPES = new Set([
  'audio/mp4', // M4A/AAC
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mpeg', //mp3
]);

const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB server maximum, per Step 3.5
const MAX_DURATION_SECONDS = 60;

// Real-vs-claimed duration won't match exactly (client-side estimation,
// encoder framing, etc.) — this just needs to catch a client lying by a
// meaningful margin, not penalize normal rounding differences.
const DURATION_MISMATCH_TOLERANCE_SECONDS = 2;

export interface UploadValidationResult {
  ok: boolean;
  errorCode?: 'TOO_LONG' | 'BAD_FORMAT';
  actualDurationSeconds?: number;
}

export async function validateAudioUpload(
  buffer: Buffer,
  claimedDurationSeconds: number,
): Promise<UploadValidationResult> {
  if (buffer.byteLength > MAX_AUDIO_BYTES) {
    return { ok: false, errorCode: 'TOO_LONG' };
  }

  // Sniff actual file signature — do not trust the client-supplied MIME/extension.
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
    console.log("not an allowed file format")
    return { ok: false, errorCode: 'BAD_FORMAT' };
  }

  // Read the real duration from the container itself — this is the fix.
  // Previously this function only checked claimedDurationSeconds, which
  // is client-supplied and was never actually verified against the file.
  let actualDurationSeconds: number;
  try {
    const metadata = await parseBuffer(buffer, { path: `audio.${detected.ext}` });
    if (!metadata.format.duration) {
      // Some encoders omit duration in the header entirely — treat as
      // unparseable rather than silently trusting the client's claim.
      console.log("audio does not have a duration")
      return { ok: false, errorCode: 'BAD_FORMAT' };
    }
    actualDurationSeconds = metadata.format.duration;
  } catch(error) {
    // Corrupt or unparseable audio despite passing the container sniff —
    // e.g. valid magic bytes but truncated/damaged body.
    console.log("actual error:", error)
    return { ok: false, errorCode: 'BAD_FORMAT' };
  }

  if (actualDurationSeconds > MAX_DURATION_SECONDS) {
    return { ok: false, errorCode: 'TOO_LONG', actualDurationSeconds };
  }

  // Client claimed a wildly different duration than what's actually in the
  // file — worth rejecting rather than silently trusting either value,
  // since Android's own resolver logic may depend on this being accurate.
  if (Math.abs(actualDurationSeconds - claimedDurationSeconds) > DURATION_MISMATCH_TOLERANCE_SECONDS) {
    console.log("complete duration mismatch ", actualDurationSeconds, claimedDurationSeconds)
    return { ok: false, errorCode: 'BAD_FORMAT', actualDurationSeconds };
  }

  return { ok: true, actualDurationSeconds };
}