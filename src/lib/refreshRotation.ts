import { generateRefreshCredential, hashRefreshCredential } from './crypto';
import { prisma } from './prisma';

export const REFRESH_GRACE_MILLIS = 2 * 60 * 1000;

type QuotaTier = 'UNVERIFIED' | 'VERIFIED';

interface RefreshInstallationRow {
  id: string;
  status: 'ACTIVE' | 'REVOKED';
  quotaTier: QuotaTier;
  refreshCredentialHash: string;
  previousRefreshCredentialHash: string | null;
  previousRefreshCredentialExpiresAt: Date | null;
}

interface RefreshRotationDatabase {
  installation: {
    findFirst(args: unknown): Promise<RefreshInstallationRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

export type RefreshRotationResult =
  | {
      kind: 'ROTATED';
      installationId: string;
      quotaTier: QuotaTier;
      refreshCredential: string;
      recoveredFromPrevious: boolean;
    }
  | { kind: 'INVALID' }
  | { kind: 'CONFLICT' };

/**
 * Rotates a current or short-lived previous credential through a database CAS.
 * At most one caller can consume a given current/previous slot for each
 * observed row state. Raw refresh credentials are never persisted.
 */
export async function rotateRefreshCredential(
  rawCredential: string,
  options: {
    now?: Date;
    database?: RefreshRotationDatabase;
    generate?: typeof generateRefreshCredential;
  } = {},
): Promise<RefreshRotationResult> {
  const now = options.now ?? new Date();
  const database = options.database ?? (prisma as unknown as RefreshRotationDatabase);
  const generate = options.generate ?? generateRefreshCredential;
  const presentedHash = hashRefreshCredential(rawCredential);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const installation = await database.installation.findFirst({
      where: {
        status: 'ACTIVE',
        OR: [
          { refreshCredentialHash: presentedHash },
          {
            previousRefreshCredentialHash: presentedHash,
            previousRefreshCredentialExpiresAt: { gt: now },
          },
        ],
      },
    });
    if (!installation) return { kind: 'INVALID' };

    const matchesCurrent = installation.refreshCredentialHash === presentedHash;
    const matchesPrevious =
      installation.previousRefreshCredentialHash === presentedHash &&
      installation.previousRefreshCredentialExpiresAt != null &&
      installation.previousRefreshCredentialExpiresAt > now;
    if (!matchesCurrent && !matchesPrevious) return { kind: 'INVALID' };

    const next = generate();
    const where = matchesCurrent
      ? {
          id: installation.id,
          status: 'ACTIVE',
          refreshCredentialHash: presentedHash,
        }
      : {
          id: installation.id,
          status: 'ACTIVE',
          refreshCredentialHash: installation.refreshCredentialHash,
          previousRefreshCredentialHash: presentedHash,
          previousRefreshCredentialExpiresAt: { gt: now },
        };

    const updated = await database.installation.updateMany({
      where,
      data: {
        refreshCredentialHash: next.hash,
        previousRefreshCredentialHash: installation.refreshCredentialHash,
        previousRefreshCredentialExpiresAt: new Date(now.getTime() + REFRESH_GRACE_MILLIS),
        lastSeenAt: now,
      },
    });
    if (updated.count === 1) {
      return {
        kind: 'ROTATED',
        installationId: installation.id,
        quotaTier: installation.quotaTier,
        refreshCredential: next.raw,
        recoveredFromPrevious: matchesPrevious,
      };
    }
  }

  return { kind: 'CONFLICT' };
}
