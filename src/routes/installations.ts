import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { generateRefreshCredential, hashRefreshCredential } from '../lib/crypto';
import { signAccessToken } from '../lib/jwt';
import { requireInstallationAuth } from '../middleware/requestPrincipal';
import { registrationRateLimit } from '../middleware/registrationRateLimit';

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

  const accessToken = signAccessToken({
    installationId: installation.id,
    tier: installation.quotaTier,
  });

  return res.status(201).json({
    installationId: installation.id,
    accessToken,
    refreshCredential,
    quotaTier: installation.quotaTier,
  });
});

installationsRouter.post('/refresh', async (req, res) => {
  const { refreshCredential } = req.body as { refreshCredential?: string };

  if (!refreshCredential) {
    return res.status(400).json({ error: 'MISSING_REFRESH_CREDENTIAL' });
  }

  const hash = hashRefreshCredential(refreshCredential);
  const installation = await prisma.installation.findUnique({
    where: { refreshCredentialHash: hash },
  });

  if (!installation || installation.status === 'REVOKED') {
    return res.status(401).json({ error: 'INVALID_OR_REVOKED_CREDENTIAL' });
  }

  const { raw: newRefreshCredential, hash: newHash } = generateRefreshCredential();

  const updated = await prisma.installation.update({
    where: { id: installation.id },
    data: {
      refreshCredentialHash: newHash,
      lastSeenAt: new Date(),
    },
  });

  const accessToken = signAccessToken({
    installationId: updated.id,
    tier: updated.quotaTier,
  });

  return res.status(200).json({
    accessToken,
    refreshCredential: newRefreshCredential,
    quotaTier: updated.quotaTier,
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