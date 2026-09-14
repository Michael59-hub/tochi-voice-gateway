import { ParseResult, SCHEMA_VERSION } from './types';
import { tryDeterministicParse } from './deterministicRules';
import { tryLlmFallbackParse } from './llmFallbackParser';
import { validateDraft } from './validateDraft';

/**
 * Single entry point for turning a transcript into a validated draft.
 * Deterministic rules run first; the LLM fallback only runs on a miss.
 * Every path — rule match, LLM output, or neither — passes through the
 * same validation gate before returning, so invalid output can never
 * reach Review as executable data.
 */
export async function parseTranscriptToDraft(transcript: string): Promise<ParseResult> {
  let draft = tryDeterministicParse(transcript);

  if (!draft) {
    draft = await tryLlmFallbackParse(transcript);
  }

  if (!draft) {
    // Nothing matched, and no fallback produced anything — this is a
    // legitimate UNKNOWN, not a parse failure.
    return {
      kind: 'DRAFT',
      draft: { schemaVersion: SCHEMA_VERSION, intent: 'UNKNOWN' },
    };
  }

  const validation = validateDraft(draft);
  if (!validation.valid) {
    return { kind: 'DRAFT_ERROR', reason: validation.reason ?? 'Invalid draft' };
  }

  return { kind: 'DRAFT', draft };
}