import type { VoiceActionDraftV2 } from '../contracts/voiceV2';
import type { ProposalRequest, VoiceProposalProvider } from './types';
import {
  ProposalProviderError,
  SYSTEM_PROMPT,
  classifyProposalFailure,
} from './llmProposalProvider';

const REQUEST_TIMEOUT_MS = 20_000;

class ProviderHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function proposalUserText(request: ProposalRequest): string {
  const bounded = request.transcript.trim().slice(0, 4_000);
  const captured = Number.isFinite(request.capturedAtMillis)
    ? new Date(request.capturedAtMillis).toISOString()
    : 'unknown';
  const zone = /^[A-Za-z0-9_+\-/]{1,64}$/.test(request.timeZoneId)
    ? request.timeZoneId
    : 'unspecified';
  return `utteranceId=${request.utteranceId}\n` +
    `Spoken at ${captured} in timezone ${zone}. Extract spoken phrases only; do not invent deadlines.\n\n` +
    `Transcript:\n${bounded}`;
}

function normalizeProposal(value: unknown, request: ProposalRequest): VoiceActionDraftV2 {
  if (!value || typeof value !== 'object') throw new Error('Invalid proposal response');
  return {
    ...(value as VoiceActionDraftV2),
    schemaVersion: 2,
    utteranceId: request.utteranceId,
    originalTranscript: request.transcript.trim().slice(0, 4_000),
  };
}

export class OpenAiCompatibleProposalProvider implements VoiceProposalProvider {
  constructor(
    readonly providerName: string,
    private readonly apiKey: string | undefined,
    private readonly endpoint: string,
    private readonly model: string,
  ) {}

  async propose(request: ProposalRequest): Promise<VoiceActionDraftV2> {
    if (!this.apiKey) throw new ProposalProviderError('PROVIDER_FAILURE');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: proposalUserText(request) },
          ],
          response_format: { type: 'json_object' },
          temperature: 0,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new ProviderHttpError(response.status, `HTTP ${response.status}`);
      const body = await response.json() as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('Missing proposal content');
      return normalizeProposal(JSON.parse(content), request);
    } catch (error) {
      if (error instanceof ProposalProviderError) throw error;
      const status = error instanceof ProviderHttpError ? error.status : undefined;
      throw new ProposalProviderError(classifyProposalFailure(error), status);
    } finally {
      clearTimeout(timer);
    }
  }
}

export class FallbackProposalProvider implements VoiceProposalProvider {
  readonly providerName = 'gemini-groq-mistral-proposal-v2';

  constructor(
    private readonly gemini: VoiceProposalProvider,
    private readonly groq: VoiceProposalProvider,
    private readonly mistral: VoiceProposalProvider,
  ) {}

  async propose(request: ProposalRequest): Promise<VoiceActionDraftV2> {
    try {
      return await this.gemini.propose(request);
    } catch (error) {
      if (!(error instanceof ProposalProviderError) || error.status !== 503) throw error;
      console.warn('[Proposal] Gemini returned 503; falling back to Groq');
    }

    try {
      return await this.groq.propose(request);
    } catch (_error) {
      console.warn('[Proposal] Groq failed; falling back to Mistral');
      return this.mistral.propose(request);
    }
  }
}