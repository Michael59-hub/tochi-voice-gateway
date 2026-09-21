import { fileTypeFromBuffer } from 'file-type';
import { parseBuffer } from 'music-metadata';

const ALLOWED_MIME_TYPES = new Set([
  'audio/mp4', // M4A/AAC
  'audio/x-m4a', // file-type's MIME for an M4A major brand
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mpeg', //mp3
]);

const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB server maximum, per Step 3.5
const MAX_DURATION_SECONDS = 60;
const DURATION_MISMATCH_TOLERANCE_SECONDS = 2;

export type UploadValidationResult =
  | { ok: true; detectedMime: string; actualDurationSeconds?: number }
  | { ok: false; errorCode: 'TOO_LONG' | 'BAD_FORMAT' };

interface Mp4AudioFormat {
  codec?: string;
  hasAudio?: boolean;
  hasVideo?: boolean;
  numberOfChannels?: number;
  sampleRate?: number;
}

/** Generic MP4 byte signatures are acceptable only when the parsed track is audio-only AAC. */
export function isAudioOnlyAacMp4(format: Mp4AudioFormat): boolean {
  const codecs = format.codec?.toUpperCase().split('+').map(part => part.trim()) ?? [];
  return format.hasAudio === true &&
    format.hasVideo === false &&
    codecs.length > 0 &&
    codecs.every(codec => codec === 'MPEG-4/AAC' || codec === 'AAC') &&
    (format.numberOfChannels ?? 0) > 0 &&
    (format.sampleRate ?? 0) > 0;
}

export async function validateAudioUpload(
  buffer: Buffer,
  claimedDurationSeconds: number,
  maxAudioBytes: number = MAX_AUDIO_BYTES,
): Promise<UploadValidationResult> {
  if (!Number.isFinite(claimedDurationSeconds) || claimedDurationSeconds < 0 ||
      claimedDurationSeconds > MAX_DURATION_SECONDS) {
    return { ok: false, errorCode: 'BAD_FORMAT' };
  }
  if (buffer.byteLength > maxAudioBytes) {
    return { ok: false, errorCode: 'TOO_LONG' };
  }

  // Sniff actual file signature — do not trust the client-supplied MIME/extension.
  const detected = await fileTypeFromBuffer(buffer);
  const genericMp4Candidate = detected?.mime === 'video/mp4';
  if (!detected || (!ALLOWED_MIME_TYPES.has(detected.mime) && !genericMp4Candidate)) {
    return { ok: false, errorCode: 'BAD_FORMAT' };
  }

  const detectedMime = genericMp4Candidate || detected.mime === 'audio/x-m4a'
    ? 'audio/mp4' : detected.mime;
  let actualDurationSeconds: number | undefined;
  if (genericMp4Candidate) {
    try {
      const metadata = await parseBuffer(buffer, { path: `audio.${detected.ext}` });
      actualDurationSeconds = metadata.format.duration;
      if (!isAudioOnlyAacMp4(metadata.format) ||
          actualDurationSeconds === undefined || !Number.isFinite(actualDurationSeconds) ||
          actualDurationSeconds <= 0) {
        return { ok: false, errorCode: 'BAD_FORMAT' };
      }
    } catch {
      return { ok: false, errorCode: 'BAD_FORMAT' };
    }
  }
  if (detectedMime === 'audio/mp4') {
    actualDurationSeconds ??= readM4aDurationSeconds(buffer) ?? undefined;
    if (actualDurationSeconds === undefined || actualDurationSeconds <= 0) {
      return { ok: false, errorCode: 'BAD_FORMAT' };
    }
    if (actualDurationSeconds > MAX_DURATION_SECONDS) return { ok: false, errorCode: 'TOO_LONG' };
    if (Math.abs(actualDurationSeconds - claimedDurationSeconds) > DURATION_MISMATCH_TOLERANCE_SECONDS) {
      return { ok: false, errorCode: 'BAD_FORMAT' };
    }
  }

  return { ok: true, detectedMime, actualDurationSeconds };
}

function readM4aDurationSeconds(buffer: Buffer): number | null {
  const moov = findMp4Box(buffer, 0, buffer.length, 'moov');
  if (!moov) return null;
  const mvhd = findMp4Box(buffer, moov.start, moov.end, 'mvhd');
  if (!mvhd || mvhd.end - mvhd.start < 20) return null;

  const version = buffer[mvhd.start];
  if (version === 0) {
    const timescale = buffer.readUInt32BE(mvhd.start + 12);
    const duration = buffer.readUInt32BE(mvhd.start + 16);
    return timescale > 0 ? duration / timescale : null;
  }
  if (version === 1 && mvhd.end - mvhd.start >= 32) {
    const timescale = buffer.readUInt32BE(mvhd.start + 20);
    const duration = buffer.readBigUInt64BE(mvhd.start + 24);
    if (timescale === 0 || duration > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(duration) / timescale;
  }
  return null;
}

function findMp4Box(
  buffer: Buffer,
  start: number,
  end: number,
  wantedType: string,
): { start: number; end: number } | null {
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (offset + 16 > end) return null;
      const extended = buffer.readBigUInt64BE(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(extended);
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) return null;
    if (type === wantedType) {
      return { start: offset + headerSize, end: offset + size };
    }
    offset += size;
  }
  return null;
}
