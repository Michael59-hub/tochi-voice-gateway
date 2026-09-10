import { SpeechProviderAdapter, TranscriptionRequest, TranscriptionResult } from './types';

export class MockAdapter implements SpeechProviderAdapter {
  readonly providerName = 'mock';

  async transcribe(_request: TranscriptionRequest): Promise<TranscriptionResult> {
    return {
      kind: 'SUCCESS',
      provider: this.providerName,
      model: 'mock-v1',
      transcript: 'Remind me to submit my assignment tomorrow at 8 in the morning',
      confidence: 1.0,
      latencyMs: 0,
    };
  }
}