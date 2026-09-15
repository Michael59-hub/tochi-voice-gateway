import { SpeechProviderAdapter } from './types';
import { MockAdapter } from './mockAdapter';
import { SaharaAdapter } from './saharaAdapter';
import { MockProposalProvider } from './mockProposalProvider';
import { VoiceProposalProvider } from './types';

export function getPrimaryProvider(): SpeechProviderAdapter {
  const mode = process.env.VOICE_PROVIDER_MODE ?? 'mock';

  switch (mode) {
    case 'mock':
      return new MockAdapter();
    case 'sahara':
      return new SaharaAdapter();
    default:
      throw new Error(`Unknown VOICE_PROVIDER_MODE: ${mode}`);
  }
}

export function getPrimaryProposalProvider(): VoiceProposalProvider {
  return new MockProposalProvider();
}
