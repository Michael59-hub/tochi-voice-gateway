import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const SECRET = process.env.JWT_SIGNING_SECRET ?? '';

if (!SECRET) {
  throw new Error('JWT_SIGNING_SECRET is not set');
}

export interface AccessTokenClaims {
  installationId: string;
  tier: 'UNVERIFIED' | 'VERIFIED';
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, SECRET, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  return jwt.verify(token, SECRET) as unknown as AccessTokenClaims;
}