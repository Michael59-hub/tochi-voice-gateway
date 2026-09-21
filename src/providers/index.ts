import { SpeechProviderAdapter } from './types';
import { MockAdapter } from './mockAdapter';
import { SaharaAdapter } from './saharaAdapter';
import { MockProposalProvider } from './mockProposalProvider';
import { VoiceProposalProvider } from './types';
import { LlmProposalProvider } from './llmProposalProvider';

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
  const mode = process.env.VOICE_PROPOSAL_PROVIDER_MODE ?? 'auto';
  if (mode === 'mock') return new MockProposalProvider();
  if (mode === 'llm' || mode === 'auto') return new LlmProposalProvider();
  throw new Error('Unknown VOICE_PROPOSAL_PROVIDER_MODE');
}
