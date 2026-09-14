import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  rotate: vi.fn(),
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    installation: {
      create: mocks.create,
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock('../src/lib/refreshRotation', () => ({
  rotateRefreshCredential: mocks.rotate,
}));

import { installationsRouter } from '../src/routes/installations';

const app = express();
app.use(express.json());
app.use('/v1/installations', installationsRouter);

beforeEach(() => {
  mocks.create.mockReset().mockResolvedValue({
    id: 'installation-1', quotaTier: 'UNVERIFIED',
  });
  mocks.rotate.mockReset().mockResolvedValue({
    kind: 'ROTATED', installationId: 'installation-1', quotaTier: 'UNVERIFIED',
    refreshCredential: 'rotated-placeholder', recoveredFromPrevious: false,
  });
});

describe('installation token responses', () => {
  it('registration returns an explicit 15-minute access-token expiry', async () => {
    const response = await request(app)
      .post('/v1/installations/register')
      .send({ platform: 'ANDROID' })
      .expect(201);
    expect(response.body).toMatchObject({
      installationId: 'installation-1', quotaTier: 'UNVERIFIED',
    });
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshCredential).toEqual(expect.any(String));
    expect(response.body.accessTokenExpiresAtEpochMs).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
  });

  it('refresh returns the rotated credential and explicit expiry', async () => {
    const response = await request(app)
      .post('/v1/installations/refresh')
      .send({ refreshCredential: 'old-placeholder' })
      .expect(200);
    expect(response.body).toMatchObject({
      refreshCredential: 'rotated-placeholder', quotaTier: 'UNVERIFIED',
    });
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.accessTokenExpiresAtEpochMs).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
  });

  it('rejects invalid and revoked refresh credentials', async () => {
    mocks.rotate.mockResolvedValueOnce({ kind: 'INVALID' });
    await request(app)
      .post('/v1/installations/refresh')
      .send({ refreshCredential: 'invalid-placeholder' })
      .expect(401, { error: 'INVALID_OR_REVOKED_CREDENTIAL' });
  });
});
