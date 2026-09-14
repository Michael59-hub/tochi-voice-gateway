import jwt from 'jsonwebtoken';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const SECRET = process.env.JWT_SIGNING_SECRET ?? '';

if (!SECRET) {
  throw new Error('JWT_SIGNING_SECRET is not set');
}

export interface AccessTokenClaims {
  installationId: string;
  tier: 'UNVERIFIED' | 'VERIFIED';
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, SECRET, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

export interface IssuedAccessToken {
  accessToken: string;
  accessTokenExpiresAtEpochMs: number;
}

export function issueAccessToken(claims: AccessTokenClaims): IssuedAccessToken {
  const accessToken = signAccessToken(claims);
  const decoded = jwt.decode(accessToken);
  if (!decoded || typeof decoded === 'string' || typeof decoded.exp !== 'number') {
    throw new Error('Access token expiry missing');
  }
  return {
    accessToken,
    accessTokenExpiresAtEpochMs: decoded.exp * 1000,
  };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  return jwt.verify(token, SECRET, { algorithms: ['HS256'] }) as unknown as AccessTokenClaims;
}
