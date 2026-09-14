import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  voiceRequestRecord: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma', () => ({ prisma: database }));

import { reserveVoiceRequest } from '../src/lib/idempotency';

const existing = (status: 'PROCESSING' | 'COMPLETED' | 'FAILED', fingerprint = 'same') => ({
  id: 'record-1',
  installationId: 'installation-1',
  idempotencyKey: 'key-1',
  requestFingerprintHmac: fingerprint,
  status,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
});

beforeEach(() => {
  for (const method of Object.values(database.voiceRequestRecord)) method.mockReset();
});

describe('content-free idempotency state machine', () => {
  it('reserves a new request', async () => {
    database.voiceRequestRecord.create.mockResolvedValueOnce(existing('PROCESSING'));
    await expect(reserveVoiceRequest('installation-1', 'key-1', 'same')).resolves.toEqual({ kind: 'RESERVED' });
  });

  it.each([
    ['PROCESSING', 'REQUEST_IN_PROGRESS'],
    ['COMPLETED', 'ALREADY_PROCESSED'],
  ] as const)('maps matching %s records to %s', async (status, kind) => {
    database.voiceRequestRecord.create.mockRejectedValueOnce({ code: 'P2002' });
    database.voiceRequestRecord.findUnique.mockResolvedValueOnce(existing(status));
    await expect(reserveVoiceRequest('installation-1', 'key-1', 'same')).resolves.toEqual({ kind });
  });

  it('rejects the same key with a different fingerprint', async () => {
    database.voiceRequestRecord.create.mockRejectedValueOnce({ code: 'P2002' });
    database.voiceRequestRecord.findUnique.mockResolvedValueOnce(existing('COMPLETED', 'different'));
    await expect(reserveVoiceRequest('installation-1', 'key-1', 'same')).resolves.toEqual({ kind: 'IDEMPOTENCY_CONFLICT' });
  });

  it('atomically re-reserves a matching FAILED record', async () => {
    database.voiceRequestRecord.create.mockRejectedValueOnce({ code: 'P2002' });
    database.voiceRequestRecord.findUnique.mockResolvedValueOnce(existing('FAILED'));
    database.voiceRequestRecord.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(reserveVoiceRequest('installation-1', 'key-1', 'same')).resolves.toEqual({ kind: 'RESERVED' });
    expect(database.voiceRequestRecord.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'FAILED', requestFingerprintHmac: 'same' }),
      data: expect.objectContaining({ status: 'PROCESSING' }),
    }));
  });

  it('uses uniqueness to make concurrent first reservations safe', async () => {
    let inserted = false;
    database.voiceRequestRecord.create.mockImplementation(async () => {
      if (!inserted) {
        inserted = true;
        return existing('PROCESSING');
      }
      throw { code: 'P2002' };
    });
    database.voiceRequestRecord.findUnique.mockResolvedValue(existing('PROCESSING'));
    const outcomes = await Promise.all([
      reserveVoiceRequest('installation-1', 'key-1', 'same'),
      reserveVoiceRequest('installation-1', 'key-1', 'same'),
    ]);
    expect(outcomes.map((it) => it.kind).sort()).toEqual(['REQUEST_IN_PROGRESS', 'RESERVED']);
  });
});
