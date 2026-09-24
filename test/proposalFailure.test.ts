import assert from 'node:assert/strict';
import { it as test } from 'vitest';
import {
  classifyProposalFailure,
  LlmProposalProvider,
  ProposalProviderError,
} from '../src/providers/llmProposalProvider';
import { getPrimaryProposalProvider } from '../src/providers';
import { FallbackProposalProvider } from '../src/providers/proposalFallbackProvider';
import type { ProposalRequest, VoiceProposalProvider } from '../src/providers/types';
import type { VoiceActionDraftV2 } from '../src/contracts/voiceV2';

test('Gemini failures map to fixed safe categories', () => {
  assert.equal(classifyProposalFailure({ status: 429, message: 'sensitive' }), 'RATE_LIMITED');
  assert.equal(classifyProposalFailure({ status: 504, message: 'sensitive' }), 'TIMEOUT');
  assert.equal(classifyProposalFailure({ status: 500, message: 'sensitive' }), 'PROVIDER_FAILURE');
  assert.equal(classifyProposalFailure(new Error('sensitive')), 'PROVIDER_FAILURE');
  assert.equal(classifyProposalFailure(new ProposalProviderError('TIMEOUT')), 'TIMEOUT');
});

test('auto mode never silently selects mock proposal generation', () => {
  const previous = process.env.VOICE_PROPOSAL_PROVIDER_MODE;
  try {
    process.env.VOICE_PROPOSAL_PROVIDER_MODE = 'auto';
    assert.ok(getPrimaryProposalProvider().providerName === 'gemini-groq-mistral-proposal-v2');
  } finally {
    if (previous === undefined) delete process.env.VOICE_PROPOSAL_PROVIDER_MODE;
    else process.env.VOICE_PROPOSAL_PROVIDER_MODE = previous;
  }
});

test('Gemini 503 falls back to Groq and then Mistral', async () => {
  const calls: string[] = [];
  const request: ProposalRequest = {
    utteranceId: 'test-utterance',
    transcript: 'create a task',
    capturedAtMillis: 1,
    timeZoneId: 'UTC',
  };
  const draft: VoiceActionDraftV2 = {
    schemaVersion: 2,
    utteranceId: request.utteranceId,
    intent: 'UNKNOWN',
    originalTranscript: request.transcript,
  };
  const provider = (name: string, failure?: ProposalProviderError): VoiceProposalProvider => ({
    providerName: name,
    async propose() {
      calls.push(name);
      if (failure) throw failure;
      return draft;
    },
  });

  const result = await new FallbackProposalProvider(
    provider('gemini', new ProposalProviderError('RATE_LIMITED', 503)),
    provider('groq', new ProposalProviderError('PROVIDER_FAILURE')),
    provider('mistral'),
  ).propose(request);

  assert.deepEqual(calls, ['gemini', 'groq', 'mistral']);
  assert.equal(result.intent, 'UNKNOWN');
});

test('non-503 Gemini failures do not invoke fallbacks', async () => {
  const calls: string[] = [];
  const provider = (name: string): VoiceProposalProvider => ({
    providerName: name,
    async propose() {
      calls.push(name);
      throw new ProposalProviderError('PROVIDER_FAILURE', 500);
    },
  });

  await assert.rejects(
    new FallbackProposalProvider(provider('gemini'), provider('groq'), provider('mistral')).propose({
      utteranceId: 'test-utterance',
      transcript: 'create a task',
      capturedAtMillis: 1,
      timeZoneId: 'UTC',
    }),
    (error: unknown) => error instanceof ProposalProviderError && error.status === 500,
  );
  assert.deepEqual(calls, ['gemini']);
});

test('unconfigured Gemini fails without creating a proposal', async () => {
  if (process.env.GEMINI_API_KEY) return;
  await assert.rejects(
    new LlmProposalProvider().propose({
      utteranceId: 'test-utterance',
      transcript: 'create a task',
      capturedAtMillis: 1,
      timeZoneId: 'UTC',
    }),
    (error: unknown) =>
      error instanceof ProposalProviderError && error.category === 'PROVIDER_FAILURE',
  );
});
