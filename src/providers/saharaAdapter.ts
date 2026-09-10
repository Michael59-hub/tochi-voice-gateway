import { SpeechProviderAdapter, TranscriptionRequest, TranscriptionResult } from './types';

const SAHARA_API_URL = process.env.SAHARA_API_URL;
const SAHARA_API_KEY = process.env.SAHARA_API_KEY;
const SAHARA_TIMEOUT_MS = 8000;

// Shape is a best guess pending Sahara's actual onboarding docs (Step 4.2
// says "implement from its verified onboarding documentation") — treat
// every field name here as provisional until checked against the real spec.
interface SaharaResponseBody {
  transcript: string;
  model: string;
  confidence?: number;
}

export class SaharaAdapter implements SpeechProviderAdapter {
  readonly providerName = 'sahara';

  constructor() {
    if (!SAHARA_API_URL || !SAHARA_API_KEY) {
      throw new Error('SAHARA_API_URL and SAHARA_API_KEY must be set to use the Sahara adapter');
    }
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SAHARA_TIMEOUT_MS);

    try {
      const response = await fetch(`${SAHARA_API_URL}/v1/transcribe`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SAHARA_API_KEY}`,
          'Content-Type': request.mimeType,
          ...(request.languageHint ? { 'X-Language-Hint': request.languageHint } : {}),
        },
        body: request.audioBuffer,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          kind: 'FAILURE',
          provider: this.providerName,
          errorCode: 'PROVIDER_ERROR',
          message: `Sahara returned HTTP ${response.status}`,
        };
      }

      const body = (await response.json()) as SaharaResponseBody;

      return {
        kind: 'SUCCESS',
        provider: this.providerName,
        model: body.model,
        transcript: body.transcript,
        confidence: body.confidence,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      clearTimeout(timeout);

      if (err instanceof Error && err.name === 'AbortError') {
        return {
          kind: 'FAILURE',
          provider: this.providerName,
          errorCode: 'TIMEOUT',
          message: 'Sahara request exceeded timeout',
        };
      }

      // Per Step 4.2: "one retry only for definite pre-send network failures."
      // This catch block covers post-send failures (connection reset mid-flight,
      // DNS resolution failure before any bytes sent, etc.) — a real distinction
      // between "definitely pre-send" and "possibly reached the provider" needs
      // care here; a naive retry risks double-charging if the request did land.
      // Leaving as a single attempt for now — do not add a retry without
      // confirming Sahara's own idempotency support, per the plan's explicit
      // caution in Step 3.6.
      return {
        kind: 'FAILURE',
        provider: this.providerName,
        errorCode: 'PROVIDER_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error calling Sahara',
      };
    }
  }
}