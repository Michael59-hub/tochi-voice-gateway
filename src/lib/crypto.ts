import { randomBytes, createHash } from 'crypto';

export function generateRefreshCredential(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  const hash = hashRefreshCredential(raw);
  return { raw, hash };
}

export function hashRefreshCredential(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}