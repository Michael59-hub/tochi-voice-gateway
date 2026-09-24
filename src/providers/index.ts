import { SpeechProviderAdapter } from './types';
import { MockAdapter } from './mockAdapter';
import { SaharaAdapter } from './saharaAdapter';
import { MockProposalProvider } from './mockProposalProvider';
import { VoiceProposalProvider } from './types';
import { LlmProposalProvider } from './llmProposalProvider';
import {
  FallbackProposalProvider,
  OpenAiCompatibleProposalProvider,
} from './proposalFallbackProvider';

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
  if (mode === 'llm' || mode === 'auto') {
    return new FallbackProposalProvider(
      new LlmProposalProvider(),
      new OpenAiCompatibleProposalProvider(
        'groq-proposal-v2',
        process.env.GROQ_API_KEY,
        process.env.GROQ_API_URL ?? 'https://api.groq.com/openai/v1/chat/completions',
        process.env.GROQ_PROPOSAL_MODEL ?? 'llama-3.3-70b-versatile',
      ),
      new OpenAiCompatibleProposalProvider(
        'mistral-proposal-v2',
        process.env.MISTRAL_API_KEY,
        process.env.MISTRAL_API_URL ?? 'https://api.mistral.ai/v1/chat/completions',
        process.env.MISTRAL_PROPOSAL_MODEL ?? 'mistral-large-latest',
      ),
    );
  }
  throw new Error('Unknown VOICE_PROPOSAL_PROVIDER_MODE');
}
