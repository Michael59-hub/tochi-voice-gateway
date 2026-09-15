import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  VoiceActionDraftV2,
  validateVoiceActionDraftV2,
  validateVoiceProposeMetadataV2,
} from '../src/contracts/voiceV2';
import { MockProposalProvider } from '../src/providers/mockProposalProvider';

const goldens = JSON.parse(
  readFileSync(join(process.cwd(), 'test/fixtures/voice-v2-goldens.json'), 'utf8'),
) as VoiceActionDraftV2[];

describe('VoiceActionDraft v2 contract', () => {
  it('accepts all supported Android intent goldens without identifiers', () => {
    expect(goldens).toHaveLength(9);
    for (const golden of goldens) {
      expect(validateVoiceActionDraftV2(golden, golden.utteranceId)).toEqual({ ok: true, value: golden });
      expect(JSON.stringify(golden)).not.toMatch(/taskId|reminderId|timerId|seriesId/);
    }
  });

  it('rejects wrong versions, unknown fields, unknown enums and wrong utterance echoes', () => {
    const base = goldens[0];
    expect(validateVoiceActionDraftV2({ ...base, schemaVersion: 1 })).toMatchObject({ ok: false });
    expect(validateVoiceActionDraftV2({ ...base, extra: true })).toMatchObject({ ok: false });
    expect(validateVoiceActionDraftV2({ ...base, intent: 'DELETE_TASK' })).toMatchObject({ ok: false });
    expect(validateVoiceActionDraftV2(base, 'different')).toMatchObject({ ok: false });
    expect(validateVoiceActionDraftV2({ ...base, targetQuery: 'Buy milk' })).toMatchObject({
      ok: false,
      reason: 'intent_fields',
    });
  });

  it('strictly validates v2 upload metadata', () => {
    const metadata = {
      contractVersion: 2, utteranceId: 'utt', idempotencyKey: 'utt',
      capturedAtMillis: 1_789_372_800_000, timeZoneId: 'Africa/Lagos',
      mimeType: 'audio/mp4', container: 'mpeg4', encoder: 'aac',
      channelCount: 1, sampleRateHz: 16_000, durationMillis: 4_200, sizeBytes: 84_217,
    };
    expect(validateVoiceProposeMetadataV2(metadata)).toMatchObject({ ok: true });
    expect(validateVoiceProposeMetadataV2({ ...metadata, extra: true })).toMatchObject({ ok: false });
    expect(validateVoiceProposeMetadataV2({ ...metadata, contractVersion: 1 })).toMatchObject({ ok: false });
    expect(validateVoiceProposeMetadataV2({ ...metadata, durationMillis: 60_001 })).toMatchObject({ ok: false });
  });

  it('mock proposal provider deterministically reproduces every golden', async () => {
    const provider = new MockProposalProvider();
    for (const golden of goldens) {
      const proposed = await provider.propose({
        utteranceId: golden.utteranceId,
        transcript: golden.originalTranscript,
        capturedAtMillis: 1_789_372_800_000,
        timeZoneId: 'Africa/Lagos',
      });
      expect(proposed).toEqual(golden);
    }
  });

  it('keeps ordinary audio, transcripts and drafts out of the Prisma schema', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    expect(schema).not.toMatch(/\b(audio|transcript|draft)(Buffer|Json|String)?\s+/i);
  });
});
