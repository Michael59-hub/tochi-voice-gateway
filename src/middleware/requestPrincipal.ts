import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt';

export interface RequestPrincipal {
  kind: 'installation';
  installationId: string;
  tier: 'UNVERIFIED' | 'VERIFIED';
}

declare global {
  namespace Express {
    interface Request {
      principal?: RequestPrincipal;
    }
  }
}

export function requireInstallationAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'MISSING_TOKEN' });
  }

  try {
    const claims = verifyAccessToken(header.slice('Bearer '.length));
    req.principal = {
      kind: 'installation',
      installationId: claims.installationId,
      tier: claims.tier,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'INVALID_OR_EXPIRED_TOKEN' });
  }
}