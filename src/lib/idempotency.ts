import { createHmac } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

const HMAC_SECRET = process.env.REQUEST_FINGERPRINT_SECRET;
if (!HMAC_SECRET) {
  throw new Error('REQUEST_FINGERPRINT_SECRET is not set');
}

const RECORD_TTL_HOURS = 24;

// Canonical fields per Section 13 — anything that affects the response
// goes in here, nothing else. Order matters for a stable HMAC.
export interface FingerprintInput {
  installationId: string;
  audioSha256: string;
  capturedAtEpochMs: number;
  timezone: string;
  languageHint: string | null;
  parse: boolean;
  schemaVersion: number;
  normalizedMimeAndContainer: string;
}

export interface ProposeV2FingerprintInput {
  installationId: string;
  audioSha256: string;
  utteranceId: string;
  contractVersion: number;
  capturedAtMillis: number;
  timeZoneId: string;
  detectedMime: string;
  container: string;
  encoder: string;
  channelCount: number;
  sampleRateHz: number;
  durationMillis: number;
  sizeBytes: number;
}

export function computeRequestFingerprint(input: FingerprintInput): string {
  const canonical = [
    input.installationId,
    input.audioSha256,
    String(input.capturedAtEpochMs),
    input.timezone,
    input.languageHint ?? '',
    String(input.parse),
    String(input.schemaVersion),
    input.normalizedMimeAndContainer,
  ].join('|');

  return createHmac('sha256', HMAC_SECRET!).update(canonical).digest('hex');
}

export function computeProposeV2Fingerprint(input: ProposeV2FingerprintInput): string {
  const canonical = [
    'voice-propose-v2',
    input.installationId,
    input.audioSha256,
    input.utteranceId,
    String(input.contractVersion),
    String(input.capturedAtMillis),
    input.timeZoneId,
    input.detectedMime,
    input.container,
    input.encoder,
    String(input.channelCount),
    String(input.sampleRateHz),
    String(input.durationMillis),
    String(input.sizeBytes),
  ].join('|');
  return createHmac('sha256', HMAC_SECRET!).update(canonical).digest('hex');
}

export type IdempotencyOutcome =
  | { kind: 'RESERVED' } // caller may proceed to call the provider
  | { kind: 'REQUEST_IN_PROGRESS' }
  | { kind: 'ALREADY_PROCESSED' }
  | { kind: 'IDEMPOTENCY_CONFLICT' };

/**
 * Atomically reserves (installationId, idempotencyKey) before any provider call.
 * Relies on the DB-level unique constraint to resolve races — the insert either
 * wins (caller proceeds) or throws P2002 (caller reads the existing row and branches).
 */
export async function reserveVoiceRequest(
  installationId: string,
  idempotencyKey: string,
  fingerprint: string,
): Promise<IdempotencyOutcome> {
  try {
    await prisma.voiceRequestRecord.create({
      data: {
        installationId,
        idempotencyKey,
        requestFingerprintHmac: fingerprint,
        status: 'PROCESSING',
        expiresAt: new Date(Date.now() + RECORD_TTL_HOURS * 60 * 60 * 1000),
      },
    });
    return { kind: 'RESERVED' };
  } catch (e) {
    if ((e instanceof Prisma.PrismaClientKnownRequestError || isPrismaUniqueError(e)) && e.code === 'P2002') {
      const existing = await prisma.voiceRequestRecord.findUnique({
        where: {
          installationId_idempotencyKey: { installationId, idempotencyKey },
        },
      });

      // Row existed but vanished between the failed insert and this read
      // (e.g. cleanup job raced us) — treat as a fresh reservation attempt.
      if (!existing) {
        return reserveVoiceRequest(installationId, idempotencyKey, fingerprint);
      }

      if (existing.requestFingerprintHmac !== fingerprint) {
        return { kind: 'IDEMPOTENCY_CONFLICT' };
      }

      if (existing.status === 'PROCESSING') {
        return { kind: 'REQUEST_IN_PROGRESS' };
      }

      if (existing.status === 'FAILED') {
        const retry = await prisma.voiceRequestRecord.updateMany({
          where: {
            id: existing.id,
            status: 'FAILED',
            requestFingerprintHmac: fingerprint,
          },
          data: {
            status: 'PROCESSING',
            expiresAt: new Date(Date.now() + RECORD_TTL_HOURS * 60 * 60 * 1000),
          },
        });
        if (retry.count === 1) return { kind: 'RESERVED' };
        return reserveVoiceRequest(installationId, idempotencyKey, fingerprint);
      }

      // COMPLETED with a matching fingerprint remains content-free.
      return { kind: 'ALREADY_PROCESSED' };
    }
    throw e;
  }
}

function isPrismaUniqueError(value: unknown): value is { code: string } {
  return typeof value === 'object' && value !== null && 'code' in value;
}

export async function markVoiceRequestCompleted(installationId: string, idempotencyKey: string) {
  await prisma.voiceRequestRecord.update({
    where: { installationId_idempotencyKey: { installationId, idempotencyKey } },
    data: { status: 'COMPLETED' },
  });
}

export async function markVoiceRequestFailed(installationId: string, idempotencyKey: string) {
  await prisma.voiceRequestRecord.update({
    where: { installationId_idempotencyKey: { installationId, idempotencyKey } },
    data: { status: 'FAILED' },
  });
}

/** Scheduled cleanup — call from a cron entrypoint, not from request handlers. */
export async function cleanupExpiredRequestRecords(): Promise<number> {
  const result = await prisma.voiceRequestRecord.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
