import assert from 'node:assert/strict';
import { it as test } from 'vitest';
import {
  classifyProposalFailure,
  LlmProposalProvider,
  ProposalProviderError,
} from '../src/providers/llmProposalProvider';
import { getPrimaryProposalProvider } from '../src/providers';

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
    assert.ok(getPrimaryProposalProvider() instanceof LlmProposalProvider);
  } finally {
    if (previous === undefined) delete process.env.VOICE_PROPOSAL_PROVIDER_MODE;
    else process.env.VOICE_PROPOSAL_PROVIDER_MODE = previous;
  }
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
