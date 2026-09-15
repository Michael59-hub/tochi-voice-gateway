import { defineConfig } from 'vitest/config';

process.env.JWT_SIGNING_SECRET ??= 'test-jwt-signing-secret-at-least-32-bytes';
process.env.REQUEST_FINGERPRINT_SECRET ??= 'test-fingerprint-secret-at-least-32-bytes';

export default defineConfig({
  test: {
    environment: 'node',
    clearMocks: true,
  },
});
