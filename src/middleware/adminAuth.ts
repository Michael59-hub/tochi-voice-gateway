import { Request, Response, NextFunction } from 'express';

const ADMIN_SECRET = process.env.ADMIN_API_SECRET;
if (!ADMIN_SECRET) {
  throw new Error('ADMIN_API_SECRET is not set');
}

// Deliberately separate from installation auth — this controls a global
// kill switch, not a per-installation resource. Simple shared-secret is
// proportionate for a hackathon; swap for a real admin-account system
// before any production exposure.
export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('X-Admin-Secret');
  if (!header || header !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  next();
}