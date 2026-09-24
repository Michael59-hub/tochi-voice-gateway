import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';

// Per-tier limits — tune these for the hackathon; not specified numerically by the plan.
const LIMITS = {
  UNVERIFIED: { maxConcurrent: 1, maxRequestsPerDay: 20 },
  VERIFIED: { maxConcurrent: 3, maxRequestsPerDay: 200 },
} as const;

const GLOBAL_MAX_CONCURRENT_PROVIDER_CALLS = 10;

// In-memory only — resets on restart, does not survive multiple instances.
// Fine for a single-process hackathon deployment; revisit with Redis if you scale out.
const concurrentByInstallation = new Map<string, number>();
let globalConcurrent = 0;

let voiceDisabled = false; // flips true via emergency switch (Step 3.3)

export function setVoiceDisabled(disabled: boolean) {
  voiceDisabled = disabled;
}

export async function enforceQuota(req: Request, res: Response, next: NextFunction) {
  if (voiceDisabled) {
    return res.status(503).json({ error: 'VOICE_DISABLED' });
  }

  const principal = req.principal!;
  const limits = LIMITS[principal.tier];

  const current = concurrentByInstallation.get(principal.installationId) ?? 0;
  if (current >= limits.maxConcurrent) {
    return res.status(429).json({ error: 'CONCURRENCY_LIMIT_EXCEEDED' });
  }

  if (globalConcurrent >= GLOBAL_MAX_CONCURRENT_PROVIDER_CALLS) {
    return res.status(429).json({ error: 'GLOBAL_CONCURRENCY_LIMIT_EXCEEDED' });
  }

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const requestsToday = await prisma.voiceRequestRecord.count({
    where: { installationId: principal.installationId, createdAt: { gte: since } },
  });

  if (requestsToday >= limits.maxRequestsPerDay) {
    return res.status(429).json({ error: 'DAILY_QUOTA_EXCEEDED' });
  }

  // Reserve concurrency slots; released in the route's finally block.
  concurrentByInstallation.set(principal.installationId, current + 1);
  globalConcurrent += 1;

  const release = () => {
  concurrentByInstallation.set(
    principal.installationId,
    Math.max(0, (concurrentByInstallation.get(principal.installationId) ?? 1) - 1),
  );
    globalConcurrent = Math.max(0, globalConcurrent - 1);
  };
  res.once('finish', release);
  res.once('close', release);

  next();
}