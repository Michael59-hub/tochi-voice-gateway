import { RequestHandler, Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import { createHash, randomUUID } from 'crypto';
import { requireInstallationAuth } from '../middleware/requestPrincipal';
import { enforceQuota } from '../middleware/quota';
import { validateAudioUpload } from '../lib/uploadValidation';
import {
  computeRequestFingerprint,
  computeProposeV2Fingerprint,
  reserveVoiceRequest,
  markVoiceRequestCompleted,
  markVoiceRequestFailed,
} from '../lib/idempotency';
import { getPrimaryProvider, getPrimaryProposalProvider } from '../providers';
import { ProposalProviderError } from '../providers/llmProposalProvider';
import {
  validateVoiceActionDraftV2,
  validateVoiceProposeMetadataV2,
} from '../contracts/voiceV2';

export const voiceRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(), // bounded by limits below; never touches disk unvalidated
  limits: { fileSize: 5 * 1024 * 1024 },
});

const proposeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1_000_000 },
});

const proposeAudioUpload: RequestHandler = (req, res, next) => {
  proposeUpload.single('audio')(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'AUDIO_TOO_LARGE' });
      return;
    }
    if (error) {
      res.status(422).json({ error: 'INVALID_MULTIPART' });
      return;
    }
    next();
  });
};

const metadataSchema = {
  schemaVersion: 1,
} as const;

/** One bounded request: Sahara transcription plus proposal generation. */
const VOICE_BUDGET_MS = 145_000;
const TIMEZONE_PATTERN = /^[A-Za-z0-9_+\-/]{1,64}$/;

/** /transcribe is transcription-only, including the authorized parse=false approval turn. */

voiceRouter.post(
  '/transcribe',
  requireInstallationAuth,
  enforceQuota,
  upload.single('audio'),
  async (req, res) => {
    const idempotencyKey = req.header('Idempotency-Key');
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'MISSING_IDEMPOTENCY_KEY' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'MISSING_AUDIO' });
    }

    let meta: {
      schemaVersion: number;
      capturedAtEpochMs: number;
      timezone: string;
      languageHint?: string;
      parse: boolean;
      audio?: { durationSeconds?: number };
    };
  
    try {
      meta = JSON.parse(req.body.meta);
    } catch {
      return res.status(422).json({ error: 'INVALID_METADATA' });
    }
    if (meta.schemaVersion !== metadataSchema.schemaVersion) {
      return res.status(400).json({ error: 'UNSUPPORTED_SCHEMA_VERSION' });
    }
    if (!Number.isFinite(meta.capturedAtEpochMs) || meta.capturedAtEpochMs <= 0 ||
        typeof meta.timezone !== 'string' || !TIMEZONE_PATTERN.test(meta.timezone) ||
        typeof meta.parse !== 'boolean' ||
        (meta.languageHint !== undefined && typeof meta.languageHint !== 'string')) {
      return res.status(422).json({ error: 'INVALID_METADATA' });
    }

    const claimedDuration = meta.audio?.durationSeconds ?? 0;
    const validation = await validateAudioUpload(req.file.buffer, claimedDuration);
    if (!validation.ok) {
      return res.status(validation.errorCode === 'TOO_LONG' ? 400 : 415).json({
        error: validation.errorCode,
      });
    }
    const detectedMime = validation.detectedMime;
    const installationId = req.principal!.installationId;
    const audioSha256 = createHash('sha256').update(req.file.buffer).digest('hex');

    const fingerprint = computeRequestFingerprint({
      installationId,
      audioSha256,
      capturedAtEpochMs: meta.capturedAtEpochMs,
      timezone: meta.timezone,
      languageHint: meta.languageHint ?? null,
      parse: meta.parse,
      schemaVersion: meta.schemaVersion,
      normalizedMimeAndContainer: detectedMime,
    });

    const reservation = await reserveVoiceRequest(installationId, idempotencyKey, fingerprint);

    switch (reservation.kind) {
      case 'REQUEST_IN_PROGRESS':
        return res.status(409).json({ error: 'REQUEST_IN_PROGRESS' });
      case 'ALREADY_PROCESSED':
        return res.status(409).json({ error: 'ALREADY_PROCESSED' });
      case 'IDEMPOTENCY_CONFLICT':
        return res.status(409).json({ error: 'IDEMPOTENCY_CONFLICT' });
      case 'RESERVED':
        break; // proceed
    }

    const deadline = Date.now() + VOICE_BUDGET_MS;
    try {
      const provider = getPrimaryProvider();
      const transcriptionResult = await withDeadline(provider.transcribe({
        audioBuffer: req.file.buffer,
        fileName: req.file.originalname || 'audio.wav',
        mimeType: detectedMime,
        languageHint: meta.languageHint,
      }), deadline);

      if (transcriptionResult.kind === 'FAILURE') {
        await markVoiceRequestFailed(installationId, idempotencyKey);
        return res.status(502).json({ error: 'PROVIDER_FAILURE' , message: transcriptionResult.message });
      }

      const result = {
        schemaVersion: 1,
        requestId: randomUUID(),
        transcript: transcriptionResult.transcript,
        provider: transcriptionResult.provider,
      };

      await markVoiceRequestCompleted(installationId, idempotencyKey);
      return res.status(200).json(result);
    } catch (err) {
      await markVoiceRequestFailed(installationId, idempotencyKey);
      const timedOut = err instanceof Error && err.message === 'VOICE_BUDGET_EXCEEDED';
      return res.status(timedOut ? 504 : 502).json({
        error: timedOut ? 'TIMEOUT' : 'PROVIDER_FAILURE',
      });
    }
  },
);

voiceRouter.post(
  '/propose',
  requireInstallationAuth,
  enforceQuota,
  proposeAudioUpload,
  async (req, res) => {
    const idempotencyKey = req.header('Idempotency-Key');
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'MISSING_IDEMPOTENCY_KEY' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'MISSING_AUDIO' });
    }

    let rawMetadata: unknown;
    try {
      rawMetadata = JSON.parse(req.body.metadata);
    } catch {
      return res.status(422).json({ error: 'INVALID_METADATA' });
    }
    const metadataResult = validateVoiceProposeMetadataV2(rawMetadata);
    if (!metadataResult.ok) {
      const status = metadataResult.reason === 'version' ? 400 : 422;
      const error = metadataResult.reason === 'version'
        ? 'UNSUPPORTED_CONTRACT_VERSION'
        : 'INVALID_METADATA';
      return res.status(status).json({ error });
    }
    const metadata = metadataResult.value;
    if (metadata.idempotencyKey !== idempotencyKey) {
      return res.status(400).json({ error: 'IDEMPOTENCY_KEY_MISMATCH' });
    }
    if (metadata.sizeBytes !== req.file.buffer.byteLength) {
      return res.status(422).json({ error: 'INVALID_METADATA' });
    }

    const validation = await validateAudioUpload(
      req.file.buffer,
      metadata.durationMillis / 1000,
      1_000_000,
    );
    if (!validation.ok) {
      return res.status(validation.errorCode === 'TOO_LONG' ? 413 : 415).json({
        error: validation.errorCode === 'TOO_LONG' ? 'AUDIO_TOO_LARGE' : 'UNSUPPORTED_AUDIO',
      });
    }
    if (validation.detectedMime !== 'audio/mp4') {
      return res.status(415).json({ error: 'UNSUPPORTED_AUDIO' });
    }
    const declaredMime = metadata.mimeType === 'audio/x-m4a'
      ? 'audio/mp4'
      : metadata.mimeType;
    if (declaredMime !== validation.detectedMime) {
      return res.status(422).json({ error: 'INVALID_METADATA' });
    }

    const installationId = req.principal!.installationId;
    const audioSha256 = createHash('sha256').update(req.file.buffer).digest('hex');
    const fingerprint = computeProposeV2Fingerprint({
      installationId,
      audioSha256,
      utteranceId: metadata.utteranceId,
      contractVersion: metadata.contractVersion,
      capturedAtMillis: metadata.capturedAtMillis,
      timeZoneId: metadata.timeZoneId,
      detectedMime: validation.detectedMime,
      container: metadata.container,
      encoder: metadata.encoder,
      channelCount: metadata.channelCount,
      sampleRateHz: metadata.sampleRateHz,
      durationMillis: metadata.durationMillis,
      sizeBytes: metadata.sizeBytes,
    });
    const reservation = await reserveVoiceRequest(installationId, idempotencyKey, fingerprint);
    switch (reservation.kind) {
      case 'REQUEST_IN_PROGRESS':
        return res.status(409).json({ error: 'REQUEST_IN_PROGRESS' });
      case 'ALREADY_PROCESSED':
        return res.status(409).json({ error: 'ALREADY_PROCESSED' });
      case 'IDEMPOTENCY_CONFLICT':
        return res.status(409).json({ error: 'IDEMPOTENCY_CONFLICT' });
      case 'RESERVED':
        break;
    }

    const deadline = Date.now() + VOICE_BUDGET_MS;
    try {
      const transcription = await withDeadline(getPrimaryProvider().transcribe({
        audioBuffer: req.file.buffer,
        fileName: req.file.originalname || `${metadata.utteranceId}.m4a`,
        mimeType: validation.detectedMime,
      }), deadline);
      if (transcription.kind === 'FAILURE') {
        await markVoiceRequestFailed(installationId, idempotencyKey);
        if (transcription.errorCode === 'RATE_LIMITED') {
          return res.status(429).json({ error: 'RATE_LIMITED' });
        }
        if (transcription.errorCode === 'TIMEOUT') {
          return res.status(504).json({ error: 'PROVIDER_TIMEOUT' });
        }
        if (transcription.errorCode === 'UNSUPPORTED_INPUT') {
          return res.status(415).json({ error: 'UNSUPPORTED_AUDIO' });
        }
        return res.status(502).json({ error: 'PROVIDER_FAILURE' });
      }

      const proposed = await withDeadline(getPrimaryProposalProvider().propose({
        utteranceId: metadata.utteranceId,
        transcript: transcription.transcript,
        capturedAtMillis: metadata.capturedAtMillis,
        timeZoneId: metadata.timeZoneId,
      }), deadline);
      const draft = validateVoiceActionDraftV2(proposed, metadata.utteranceId);
      if (!draft.ok) {
        await markVoiceRequestFailed(installationId, idempotencyKey);
        return res.status(422).json({ error: 'INVALID_PROPOSAL' });
      }

      await markVoiceRequestCompleted(installationId, idempotencyKey);
      return res.status(200).json(draft.value);
    } catch (err) {
      await markVoiceRequestFailed(installationId, idempotencyKey);
      const category = err instanceof ProposalProviderError ? err.category : null;
      if (category === 'RATE_LIMITED') return res.status(429).json({ error: 'RATE_LIMITED' });
      const timedOut = category === 'TIMEOUT' ||
        (err instanceof Error && err.message === 'VOICE_BUDGET_EXCEEDED');
      return res.status(timedOut ? 504 : 502).json({
        error: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_FAILURE',
      });
    }
  },
);

async function withDeadline<T>(work: Promise<T>, deadlineEpochMs: number): Promise<T> {
  const remaining = deadlineEpochMs - Date.now();
  if (remaining <= 0) throw new Error('VOICE_BUDGET_EXCEEDED');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('VOICE_BUDGET_EXCEEDED')), remaining);
  });
  try {
    return await Promise.race([work, budget]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

voiceRouter.get(
  '/requests/:idempotencyKey/status',
  requireInstallationAuth,
  async (req, res) => {
    const installationId = req.principal!.installationId;
    const { idempotencyKey } = req.params as { idempotencyKey: string };

    const record = await prisma.voiceRequestRecord.findUnique({
      where: {
        installationId_idempotencyKey: { installationId, idempotencyKey },
      },
    });

    // Scoped to the caller's own installation — a request record belonging
    // to a different installation must look identical to "never existed".
    if (!record) {
      return res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
    }

    switch (record.status) {
      case 'PROCESSING':
        return res.status(200).json({ status: 'PROCESSING' });
      case 'COMPLETED':
        // Per Section 14: no response content is cached, so a poll after
        // completion confirms terminal state only — it cannot hand back
        // the transcript/draft. Android already has that from the original
        // 200 response and should not expect this endpoint to repeat it.
        return res.status(200).json({ status: 'COMPLETED' });
      case 'FAILED':
        return res.status(200).json({ status: 'FAILED' });
    }
  },
);
