import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { generateRefreshCredential } from '../lib/crypto';
import { issueAccessToken } from '../lib/jwt';
import { rotateRefreshCredential } from '../lib/refreshRotation';
import { requireInstallationAuth } from '../middleware/requestPrincipal';
import { refreshRateLimit, registrationRateLimit } from '../middleware/registrationRateLimit';

export const installationsRouter = Router();

installationsRouter.post('/register', registrationRateLimit, async (req, res) => {
  const { platform } = req.body as { platform?: 'ANDROID' | 'IOS' };

  if (platform !== 'ANDROID' && platform !== 'IOS') {
    return res.status(400).json({ error: 'INVALID_PLATFORM' });
  }

  const { raw: refreshCredential, hash: refreshCredentialHash } = generateRefreshCredential();

  const installation = await prisma.installation.create({
    data: {
      platform,
      refreshCredentialHash,
      quotaTier: 'UNVERIFIED',
    },
  });

  const issued = issueAccessToken({
    installationId: installation.id,
    tier: installation.quotaTier,
  });

  return res.status(201).json({
    installationId: installation.id,
    accessToken: issued.accessToken,
    accessTokenExpiresAtEpochMs: issued.accessTokenExpiresAtEpochMs,
    refreshCredential,
    quotaTier: installation.quotaTier,
  });
});

installationsRouter.post('/refresh', refreshRateLimit, async (req, res) => {
  const { refreshCredential } = req.body as { refreshCredential?: string };

  if (!refreshCredential) {
    return res.status(400).json({ error: 'MISSING_REFRESH_CREDENTIAL' });
  }

  const rotation = await rotateRefreshCredential(refreshCredential);
  if (rotation.kind === 'INVALID') {
    return res.status(401).json({ error: 'INVALID_OR_REVOKED_CREDENTIAL' });
  }
  if (rotation.kind === 'CONFLICT') {
    return res.status(409).json({ error: 'REFRESH_IN_PROGRESS' });
  }

  const issued = issueAccessToken({
    installationId: rotation.installationId,
    tier: rotation.quotaTier,
  });

  return res.status(200).json({
    accessToken: issued.accessToken,
    accessTokenExpiresAtEpochMs: issued.accessTokenExpiresAtEpochMs,
    refreshCredential: rotation.refreshCredential,
    quotaTier: rotation.quotaTier,
  });
});

installationsRouter.get('/me', requireInstallationAuth, async (req, res) => {
  const installation = await prisma.installation.findUnique({
    where: { id: req.principal!.installationId },
    select: {
      id: true,
      status: true,
      platform: true,
      quotaTier: true,
      createdAt: true,
      lastSeenAt: true,
    },
  });

  if (!installation) {
    return res.status(404).json({ error: 'INSTALLATION_NOT_FOUND' });
  }

  return res.status(200).json(installation);
});

installationsRouter.delete('/me', requireInstallationAuth, async (req, res) => {
  await prisma.installation.update({
    where: { id: req.principal!.installationId },
    data: {
      status: 'REVOKED',
      revokedAt: new Date(),
    },
  });

  return res.status(204).send();
});
