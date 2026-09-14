import { fileTypeFromBuffer } from 'file-type';

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

export type UploadValidationResult =
  | { ok: true; detectedMime: string }
  | { ok: false; errorCode: 'TOO_LONG' | 'BAD_FORMAT' };

export async function validateAudioUpload(
  buffer: Buffer,
  claimedDurationSeconds: number,
  maxAudioBytes: number = MAX_AUDIO_BYTES,
): Promise<UploadValidationResult> {
  if (buffer.byteLength > maxAudioBytes) {
    return { ok: false, errorCode: 'TOO_LONG' };
  }

  // Sniff actual file signature — do not trust the client-supplied MIME/extension.
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
    return { ok: false, errorCode: 'BAD_FORMAT' };
  }

  const detectedMime = detected.mime === 'audio/x-m4a' ? 'audio/mp4' : detected.mime;
  if (detectedMime === 'audio/mp4') {
    const actualDurationSeconds = readM4aDurationSeconds(buffer);
    if (actualDurationSeconds === null) return { ok: false, errorCode: 'BAD_FORMAT' };
    if (actualDurationSeconds > MAX_DURATION_SECONDS) return { ok: false, errorCode: 'TOO_LONG' };
  }

  return { ok: true, detectedMime };
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
