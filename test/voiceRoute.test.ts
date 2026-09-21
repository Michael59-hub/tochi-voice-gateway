import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  completed: vi.fn(),
  failed: vi.fn(),
  transcribe: vi.fn(),
  propose: vi.fn(),
  prisma: {
    voiceRequestRecord: {
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../src/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('../src/lib/idempotency', () => ({
  computeRequestFingerprint: vi.fn(() => 'v1-fingerprint'),
  computeProposeV2Fingerprint: vi.fn(() => 'v2-fingerprint'),
  reserveVoiceRequest: mocks.reserve,
  markVoiceRequestCompleted: mocks.completed,
  markVoiceRequestFailed: mocks.failed,
}));
vi.mock('../src/providers', () => ({
  getPrimaryProvider: () => ({ transcribe: mocks.transcribe }),
  getPrimaryProposalProvider: () => ({ propose: mocks.propose }),
}));

import { signAccessToken } from '../src/lib/jwt';
import { ProposalProviderError } from '../src/providers/llmProposalProvider';
import { voiceRouter } from '../src/routes/voice';

const app = express();
app.use(express.json());
app.use('/v1/voice', voiceRouter);

const token = signAccessToken({ installationId: 'installation-1', tier: 'UNVERIFIED' });
function m4aAudio(durationMillis = 1_000): Buffer {
  const ftyp = Buffer.from('00000018667479704d344120000000004d3441206d703432', 'hex');
  const mvhd = Buffer.alloc(28);
  mvhd.writeUInt32BE(mvhd.length, 0);
  mvhd.write('mvhd', 4);
  mvhd.writeUInt32BE(1_000, 20);
  mvhd.writeUInt32BE(durationMillis, 24);
  const moov = Buffer.alloc(8);
  moov.writeUInt32BE(moov.length + mvhd.length, 0);
  moov.write('moov', 4);
  return Buffer.concat([ftyp, moov, mvhd]);
}

const audio = m4aAudio();

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 2,
    utteranceId: 'utt-route',
    idempotencyKey: 'utt-route',
    capturedAtMillis: 1_789_372_800_000,
    timeZoneId: 'Africa/Lagos',
    mimeType: 'audio/mp4',
    container: 'mpeg4',
    encoder: 'aac',
    channelCount: 1,
    sampleRateHz: 16_000,
    durationMillis: 1_000,
    sizeBytes: audio.length,
    ...overrides,
  };
}

function propose(body: Buffer = audio, meta = metadata(), key = 'utt-route') {
  return request(app)
    .post('/v1/voice/propose')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .field('metadata', JSON.stringify(meta))
    .attach('audio', body, { filename: 'voice.m4a', contentType: 'audio/mp4' });
}

beforeEach(() => {
  mocks.reserve.mockReset().mockResolvedValue({ kind: 'RESERVED' });
  mocks.completed.mockReset().mockResolvedValue(undefined);
  mocks.failed.mockReset().mockResolvedValue(undefined);
  mocks.transcribe.mockReset().mockResolvedValue({
    kind: 'SUCCESS', provider: 'mock', transcript: 'add buy milk', latencyMs: 0,
  });
  mocks.propose.mockReset().mockResolvedValue({
    schemaVersion: 2,
    utteranceId: 'utt-route',
    intent: 'CREATE_TASK',
    originalTranscript: 'add buy milk',
    proposedTitle: 'Buy milk',
    ambiguous: false,
  });
  mocks.prisma.voiceRequestRecord.count.mockResolvedValue(0);
});

describe('POST /v1/voice/propose', () => {
  it('authenticates, returns a raw v2 draft and echoes utteranceId', async () => {
    const response = await propose().expect(200);
    expect(response.body).toMatchObject({ schemaVersion: 2, utteranceId: 'utt-route', intent: 'CREATE_TASK' });
    expect(response.body).not.toHaveProperty('draft');
    expect(response.body).not.toHaveProperty('requestId');
    expect(mocks.completed).toHaveBeenCalledWith('installation-1', 'utt-route');
  });

  it('authenticates before invoking providers', async () => {
    await request(app)
      .post('/v1/voice/propose')
      .set('Idempotency-Key', 'utt-route')
      .field('metadata', JSON.stringify(metadata()))
      .attach('audio', audio, { filename: 'voice.m4a', contentType: 'audio/mp4' })
      .expect(401, { error: 'MISSING_TOKEN' });
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it('rejects malformed metadata, mismatched keys and invalid audio signatures', async () => {
    await propose(audio, { ...metadata(), unknown: true }).expect(422, { error: 'INVALID_METADATA' });
    await propose(audio, metadata(), 'different').expect(400, { error: 'IDEMPOTENCY_KEY_MISMATCH' });
    const invalid = Buffer.from('not audio');
    await propose(invalid, metadata({ sizeBytes: invalid.length })).expect(415, { error: 'UNSUPPORTED_AUDIO' });
    await propose(audio, metadata({ mimeType: 'audio/wav' })).expect(422, { error: 'INVALID_METADATA' });
    const wav = Buffer.from(
      '524946462400000057415645666d74201000000001000100803e0000007d0000020010006461746100000000',
      'hex',
    );
    await propose(wav, metadata({
      mimeType: 'audio/wav', container: 'wav', encoder: 'pcm_s16le', sizeBytes: wav.length,
    })).expect(415, { error: 'UNSUPPORTED_AUDIO' });
  });

  it('rejects unsupported versions, missing audio and mismatched declared size', async () => {
    await propose(audio, metadata({ contractVersion: 1 })).expect(400, { error: 'UNSUPPORTED_CONTRACT_VERSION' });
    await propose(audio, metadata({ durationMillis: 60_001 })).expect(422, { error: 'INVALID_METADATA' });
    await propose(audio, metadata({ sizeBytes: audio.length + 1 })).expect(422, { error: 'INVALID_METADATA' });
    await request(app)
      .post('/v1/voice/propose')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'utt-route')
      .field('metadata', JSON.stringify(metadata()))
      .expect(400, { error: 'MISSING_AUDIO' });
  });

  it('maps Multer size failures to AUDIO_TOO_LARGE', async () => {
    const oversized = Buffer.alloc(1_000_001, 1);
    await propose(oversized, metadata({ sizeBytes: oversized.length })).expect(413, { error: 'AUDIO_TOO_LARGE' });
  });

  it('rejects M4A whose actual container duration exceeds 60 seconds', async () => {
    const tooLong = m4aAudio(60_001);
    await propose(tooLong, metadata({ durationMillis: 60_000, sizeBytes: tooLong.length }))
      .expect(413, { error: 'AUDIO_TOO_LARGE' });
  });

  it.each([
    ['REQUEST_IN_PROGRESS', 'REQUEST_IN_PROGRESS'],
    ['ALREADY_PROCESSED', 'ALREADY_PROCESSED'],
    ['IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_CONFLICT'],
  ])('maps %s reservations to stable 409 errors', async (kind, error) => {
    mocks.reserve.mockResolvedValueOnce({ kind });
    await propose().expect(409, { error });
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it('sanitizes provider failures and rejects invalid proposal output', async () => {
    mocks.transcribe.mockResolvedValueOnce({
      kind: 'FAILURE', provider: 'mock', errorCode: 'PROVIDER_ERROR', message: 'secret provider body',
    });
    const providerFailure = await propose().expect(502);
    expect(providerFailure.body).toEqual({ error: 'PROVIDER_FAILURE' });
    expect(JSON.stringify(providerFailure.body)).not.toContain('secret provider body');

    mocks.propose.mockResolvedValueOnce({ schemaVersion: 2, utteranceId: 'wrong', intent: 'UNKNOWN', originalTranscript: '' });
    await propose().expect(422, { error: 'INVALID_PROPOSAL' });
  });

  it.each([
    ['RATE_LIMITED', 429, 'RATE_LIMITED'],
    ['TIMEOUT', 504, 'PROVIDER_TIMEOUT'],
    ['UNSUPPORTED_INPUT', 415, 'UNSUPPORTED_AUDIO'],
  ])('maps provider %s without returning provider details', async (errorCode, status, error) => {
    mocks.transcribe.mockResolvedValueOnce({
      kind: 'FAILURE', provider: 'mock', errorCode, message: 'private provider response',
    });
    const response = await propose().expect(status);
    expect(response.body).toEqual({ error });
    expect(JSON.stringify(response.body)).not.toContain('private provider response');
  });

  it.each([
    ['RATE_LIMITED', 429, 'RATE_LIMITED'],
    ['TIMEOUT', 504, 'PROVIDER_TIMEOUT'],
    ['PROVIDER_FAILURE', 502, 'PROVIDER_FAILURE'],
  ] as const)('fails closed when proposal generation reports %s', async (category, status, error) => {
    mocks.propose.mockRejectedValueOnce(new ProposalProviderError(category));
    const response = await propose().expect(status, { error });
    expect(response.body).not.toHaveProperty('draft');
    expect(mocks.failed).toHaveBeenCalledWith('installation-1', 'utt-route');
  });

  it('keeps the existing v1 transcribe response available', async () => {
    const response = await request(app)
      .post('/v1/voice/transcribe')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'v1-key')
      .field('meta', JSON.stringify({
        schemaVersion: 1,
        capturedAtEpochMs: 1_789_372_800_000,
        timezone: 'Africa/Lagos',
        parse: false,
      }))
      .attach('audio', audio, { filename: 'voice.m4a', contentType: 'audio/mp4' })
      .expect(200);
    expect(response.body).toMatchObject({ schemaVersion: 1, transcript: 'add buy milk', provider: 'mock' });
    expect(response.body).not.toHaveProperty('draft');
  });
});
