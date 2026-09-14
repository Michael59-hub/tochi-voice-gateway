import rateLimit from 'express-rate-limit';

// Bounds how fast one IP can mint new installations — this is what stops
// the registration endpoint itself from becoming a free way to generate
// unlimited UNVERIFIED-tier credentials, per Step 3.3.
export const registrationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMIT_EXCEEDED' },
});

// Refresh is intentionally more permissive than registration, but still
// bounded so a stolen/expired credential cannot be hammered indefinitely.
export const refreshRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED' },
});
