import { SpeechProviderAdapter } from './types';
import { MockAdapter } from './mockAdapter';

// Server-side selection only — per Step 3.7 and Section 12, the client
// never controls which provider handles a request. When Sahara's adapter
// exists, this is the only place that changes.
export function getPrimaryProvider(): SpeechProviderAdapter {
  const mode = process.env.VOICE_PROVIDER_MODE ?? 'mock';

  switch (mode) {
    case 'mock':
      return new MockAdapter();
    // case 'sahara':
    //   return new SaharaAdapter();
    default:
      throw new Error(`Unknown VOICE_PROVIDER_MODE: ${mode}`);
  }
}