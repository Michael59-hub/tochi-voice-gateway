import axios, { isAxiosError } from 'axios';
import FormData from 'form-data';
import { SpeechProviderAdapter, TranscriptionRequest, TranscriptionResult } from './types';

const SAHARA_API_URL =
  process.env.SAHARA_API_URL ?? 'https://infer.voice.intron.io/file/v1/upload/sync';
const SAHARA_API_KEY = process.env.SAHARA_API_KEY;
const SAHARA_TIMEOUT_MS = 125_000;

interface IntronSuccessBody {
  data: {
    file_id: string;
    processing_status: 'FILE_TRANSCRIBED' | string;
    audio_file_name: string;
    audio_transcript: string;
    processed_audio_duration_in_seconds: number;
  };
  message: string;
  status: string;
}

interface IntronErrorBody {
  data: Record<string, unknown>;
  message: string;
  status: string;
}

export class SaharaAdapter implements SpeechProviderAdapter {
  readonly providerName = 'sahara';

  constructor() {
    if (!SAHARA_API_KEY) {
      throw new Error('SAHARA_API_KEY must be set to use the Sahara adapter');
    }
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const startedAt = Date.now();

    const form = new FormData();
    form.append('audio_file_name', request.fileName);
    form.append('audio_file_blob', request.audioBuffer, {
      filename: request.fileName,
      contentType: request.mimeType,
    });
    form.append('use_language_asr_input', request.languageHint ?? 'en');

    try {
      const response = await axios.post<IntronSuccessBody>(SAHARA_API_URL, form, {
        headers: {
          Authorization: `Bearer ${SAHARA_API_KEY}`,
          ...form.getHeaders(), // sets Content-Type with the correct multipart boundary
        },
        timeout: SAHARA_TIMEOUT_MS,
        validateStatus: () => true, // handle all status codes ourselves below
      });

      if (response.status === 429) {
        const retryAfterHeader = response.headers['retry-after'];
        return {
          kind: 'FAILURE',
          provider: this.providerName,
          errorCode: 'RATE_LIMITED',
          message: 'Sahara rate limit exceeded (30 req/min)',
          retryAfterSeconds: retryAfterHeader ? Number(retryAfterHeader) : undefined,
        };
      }

      if (response.status === 503) {
        return {
          kind: 'FAILURE',
          provider: this.providerName,
          errorCode: 'TIMEOUT',
          message: 'Sahara exceeded its 120s processing window',
        };
      }

      if (response.status === 400) {
        const body = response.data as unknown as IntronErrorBody;
        return {
          kind: 'FAILURE',
          provider: this.providerName,
          errorCode: 'UNSUPPORTED_INPUT',
          message: `Sahara rejected the audio: ${body.message}`,
        };
      }

      if (response.status !== 200) {
        return {
          kind: 'FAILURE',
          provider: this.providerName,
          errorCode: 'PROVIDER_ERROR',
          message: `Sahara returned HTTP ${response.status}: ${JSON.stringify(response.data)}`,
        };
      }

      const body = response.data;
      if (!body.data.audio_transcript || body.data.audio_transcript.trim().length === 0) {
        return {
          kind: 'FAILURE',
          provider: this.providerName,
          errorCode: 'PROVIDER_ERROR',
          message: `Sahara returned no transcript (status: ${body.data.processing_status})`,
        };
      }

      return {
        kind: 'SUCCESS',
        provider: this.providerName,
        transcript: body.data.audio_transcript,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      if (isAxiosError(err) && err.code === 'ECONNABORTED') {
        return {
          kind: 'FAILURE',
          provider: this.providerName,
          errorCode: 'TIMEOUT',
          message: 'Sahara request exceeded client-side timeout',
        };
      }

      return {
        kind: 'FAILURE',
        provider: this.providerName,
        errorCode: 'PROVIDER_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error calling Sahara',
      };
    }
  }
}