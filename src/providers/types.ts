export interface TranscriptionRequest {
  audioBuffer: Buffer;
  mimeType: string;
  languageHint?: string;
}

export interface TranscriptionSuccess {
  kind: 'SUCCESS';
  provider: string;
  model: string;
  transcript: string;
  confidence?: number; // ASR confidence — kept separate from parser/intent confidence
  latencyMs: number;
}

export interface TranscriptionFailure {
  kind: 'FAILURE';
  provider: string;
  errorCode: 'TIMEOUT' | 'PROVIDER_ERROR' | 'UNSUPPORTED_INPUT';
  message: string;
}

export type TranscriptionResult = TranscriptionSuccess | TranscriptionFailure;

// One interface every adapter (Sahara, comparators, mock) implements.
// Route code and the benchmark harness both depend only on this shape —
// swapping providers never touches voice.ts.
export interface SpeechProviderAdapter {
  readonly providerName: string;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}