import { decode } from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { hashRefreshCredential } from '../src/lib/crypto';
import { issueAccessToken } from '../src/lib/jwt';
import { REFRESH_GRACE_MILLIS, rotateRefreshCredential } from '../src/lib/refreshRotation';

interface State {
  id: string;
  status: 'ACTIVE' | 'REVOKED';
  quotaTier: 'UNVERIFIED' | 'VERIFIED';
  refreshCredentialHash: string;
  previousRefreshCredentialHash: string | null;
  previousRefreshCredentialExpiresAt: Date | null;
  lastSeenAt: Date;
}

function fakeDatabase(initial: State) {
  const state = { ...initial };
  const installation = {
    async findFirst(args: any) {
      if (state.status !== 'ACTIVE') return null;
      const current = args.where.OR[0].refreshCredentialHash;
      const previous = args.where.OR[1].previousRefreshCredentialHash;
      const previousAfter = args.where.OR[1].previousRefreshCredentialExpiresAt.gt as Date;
      const matches = state.refreshCredentialHash === current ||
        (state.previousRefreshCredentialHash === previous &&
          state.previousRefreshCredentialExpiresAt != null &&
          state.previousRefreshCredentialExpiresAt > previousAfter);
      return matches ? { ...state } : null;
    },
    async updateMany(args: any) {
      const where = args.where;
      if (state.id !== where.id || state.status !== where.status ||
          state.refreshCredentialHash !== where.refreshCredentialHash) return { count: 0 };
      if (where.previousRefreshCredentialHash !== undefined) {
        if (state.previousRefreshCredentialHash !== where.previousRefreshCredentialHash ||
            state.previousRefreshCredentialExpiresAt == null ||
            state.previousRefreshCredentialExpiresAt <= where.previousRefreshCredentialExpiresAt.gt) {
          return { count: 0 };
        }
      }
      Object.assign(state, args.data);
      return { count: 1 };
    },
  };
  return { state, database: { installation } };
}

function active(raw = 'refresh-old'): State {
  return {
    id: 'installation-1',
    status: 'ACTIVE',
    quotaTier: 'UNVERIFIED',
    refreshCredentialHash: hashRefreshCredential(raw),
    previousRefreshCredentialHash: null,
    previousRefreshCredentialExpiresAt: null,
    lastSeenAt: new Date(0),
  };
}

function generator(...rawValues: string[]) {
  let index = 0;
  return () => {
    const raw = rawValues[index++] ?? `generated-${index}`;
    return { raw, hash: hashRefreshCredential(raw) };
  };
}

describe('refresh rotation', () => {
  it('rotates current credentials and exposes a two-minute grace slot without storing raw values', async () => {
    const now = new Date('2026-09-14T12:00:00Z');
    const fake = fakeDatabase(active());
    const result = await rotateRefreshCredential('refresh-old', {
      now, database: fake.database, generate: generator('refresh-new'),
    });
    expect(result).toMatchObject({ kind: 'ROTATED', refreshCredential: 'refresh-new', recoveredFromPrevious: false });
    expect(fake.state.refreshCredentialHash).toBe(hashRefreshCredential('refresh-new'));
    expect(fake.state.previousRefreshCredentialHash).toBe(hashRefreshCredential('refresh-old'));
    expect(fake.state.previousRefreshCredentialExpiresAt?.getTime()).toBe(now.getTime() + REFRESH_GRACE_MILLIS);
    expect(JSON.stringify(fake.state)).not.toContain('refresh-new');
  });

  it('accepts the previous credential once during grace and rejects it afterward', async () => {
    const now = new Date('2026-09-14T12:00:00Z');
    const fake = fakeDatabase(active());
    await rotateRefreshCredential('refresh-old', {
      now, database: fake.database, generate: generator('refresh-one'),
    });
    const recovery = await rotateRefreshCredential('refresh-old', {
      now: new Date(now.getTime() + 1_000), database: fake.database, generate: generator('refresh-two'),
    });
    expect(recovery).toMatchObject({ kind: 'ROTATED', refreshCredential: 'refresh-two', recoveredFromPrevious: true });
    await expect(rotateRefreshCredential('refresh-old', {
      now: new Date(now.getTime() + 2_000), database: fake.database,
    })).resolves.toEqual({ kind: 'INVALID' });
  });

  it('rejects expired previous and revoked installation credentials', async () => {
    const now = new Date('2026-09-14T12:00:00Z');
    const expired = active('current');
    expired.previousRefreshCredentialHash = hashRefreshCredential('previous');
    expired.previousRefreshCredentialExpiresAt = new Date(now.getTime() - 1);
    await expect(rotateRefreshCredential('previous', { now, database: fakeDatabase(expired).database }))
      .resolves.toEqual({ kind: 'INVALID' });

    const revoked = active();
    revoked.status = 'REVOKED';
    await expect(rotateRefreshCredential('refresh-old', { now, database: fakeDatabase(revoked).database }))
      .resolves.toEqual({ kind: 'INVALID' });
  });

  it('uses CAS so three concurrent presentations cannot all rotate', async () => {
    const now = new Date('2026-09-14T12:00:00Z');
    const fake = fakeDatabase(active());
    const generate = generator('one', 'two', 'three', 'four');
    const results = await Promise.all([
      rotateRefreshCredential('refresh-old', { now, database: fake.database, generate }),
      rotateRefreshCredential('refresh-old', { now, database: fake.database, generate }),
      rotateRefreshCredential('refresh-old', { now, database: fake.database, generate }),
    ]);
    expect(results.filter((it) => it.kind === 'ROTATED')).toHaveLength(2);
    expect(results.filter((it) => it.kind === 'INVALID')).toHaveLength(1);
  });

  it('issues explicit expiry matching the JWT exp claim', () => {
    const issued = issueAccessToken({ installationId: 'installation-1', tier: 'UNVERIFIED' });
    const claims = decode(issued.accessToken) as { exp: number };
    expect(issued.accessTokenExpiresAtEpochMs).toBe(claims.exp * 1000);
    expect(issued.accessTokenExpiresAtEpochMs).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
  });
});
