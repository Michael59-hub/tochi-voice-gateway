export interface TranscriptionRequest {
  audioBuffer: Buffer;
  fileName: string;
  mimeType: string;
  languageHint?: string;
}

export interface TranscriptionSuccess {
  kind: 'SUCCESS';
  provider: string;
  model?: string; // not every provider returns one — Intron doesn't
  transcript: string;
  confidence?: number;
  latencyMs: number;
}

export interface TranscriptionFailure {
  kind: 'FAILURE';
  provider: string;
  errorCode: 'TIMEOUT' | 'PROVIDER_ERROR' | 'UNSUPPORTED_INPUT' | 'RATE_LIMITED';
  message: string;
  retryAfterSeconds?: number;
}

export type TranscriptionResult = TranscriptionSuccess | TranscriptionFailure;

export interface SpeechProviderAdapter {
  readonly providerName: string;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}