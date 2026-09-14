# Tochi two-model benchmark plan (with Sahara baseline)

Status: **READY FOR IMPLEMENTATION — BENCHMARK SCOPE ONLY**

## Objective

Implement two benchmark-only transcription models and measure both against the existing Sahara/Intron production provider on the same consented Tochi audio corpus. Sahara remains the only production speech provider.

The comparison models are:

1. Sahara/Intron — production and benchmark subject.
2. OpenAI `gpt-transcribe` — high-accuracy comparison.
3. OpenAI `whisper-1` — established multilingual baseline.

This plan does not authorize provider fallback, Android-side provider selection, production audio retention, or changes to the frozen VoiceActionDraft v2 contract.

## Frozen boundaries

- `POST /v1/voice/propose` calls only the server-selected production provider.
- Production configuration selects Sahara explicitly; missing Sahara configuration fails closed.
- Benchmark providers are reachable only from the benchmark runner, never from public voice routes.
- All provider credentials remain server-side environment variables.
- Normal Android audio, transcripts, and drafts remain unpersisted.
- Benchmark audio is an explicit, consented fixture corpus outside normal request handling.
- Benchmark runs do not create `VoiceRequestRecord` rows or share production idempotency keys.
- Every provider receives the same M4A bytes and language hint.
- Transcription and proposal comparisons remain separate so ASR quality is not confused with intent parsing quality.

## Implementation contract

Keep the existing `SpeechProviderAdapter` interface. Add one configurable OpenAI adapter and instantiate it twice:

```text
getProductionSpeechProvider()
└── SaharaSpeechProvider

getBenchmarkSpeechProviders()
├── SaharaSpeechProvider
├── OpenAiTranscriptionProvider(model = "gpt-transcribe")
└── OpenAiTranscriptionProvider(model = "whisper-1")
```

The production factory must not import or call the benchmark registry. The benchmark runner may use bounded parallelism, but one provider failure must be recorded independently and must not abort the other provider results.

`OpenAiTranscriptionProvider` must:

- receive `{ model, apiKey, baseUrl?, timeoutMillis? }` in its constructor;
- call `POST /v1/audio/transcriptions` as multipart with `file`, `model`, and optional `language`;
- send the original `.m4a` filename, `audio/mp4` content type, and unchanged audio bytes;
- read only the documented transcript `text` field;
- map timeout, rate-limit, unsupported-input, and other provider failures into the existing sanitized `SpeechProviderError` categories; and
- never log credentials, headers, audio, provider response bodies, or transcript content.

Add `getBenchmarkSpeechProviders(env)` as a benchmark-only export in a new `src/benchmark/providers.ts` module. Do not export it from `src/providers/index.ts`; that module remains the production provider boundary.

## Configuration

```dotenv
VOICE_PROVIDER_MODE=sahara
SAHARA_API_URL=...
SAHARA_API_KEY=...
OPENAI_API_KEY=...
BENCHMARK_OPENAI_MODELS=gpt-transcribe,whisper-1
```

`OPENAI_API_KEY` and `BENCHMARK_OPENAI_MODELS` are required only by the benchmark command. They must not be required to start the production server.

## Files to add

```text
src/providers/openAiTranscriptionProvider.ts
src/benchmark/types.ts
src/benchmark/providers.ts
src/benchmark/loadManifest.ts
src/benchmark/metrics.ts
src/benchmark/runVoiceBenchmark.ts
benchmark/fixtures/.gitignore
benchmark/results/.gitignore
test/openAiTranscriptionProvider.test.ts
test/voiceBenchmark.test.ts
```

## Files to modify

```text
package.json
.env.example
.gitignore
README.md
```

Do not modify the Android contract, `/v1/voice/propose` response schema, Prisma schema, installation authentication, refresh rotation, or production idempotency behavior for this benchmark increment.

## Fixture manifest

The runner accepts a strict metadata manifest. Referenced audio files remain ignored unless they are deliberately cleared for publication:

```json
{
  "schemaVersion": 1,
  "cases": [
    {
      "id": "pidgin-reminder-01",
      "audioPath": "fixtures/pidgin-reminder-01.m4a",
      "referenceTranscript": "remind me make I call mama tomorrow by nine",
      "languageHint": "en",
      "expectedIntent": "CREATE_REMINDER",
      "tags": ["pidgin", "reminder", "quiet"]
    }
  ]
}
```

Validation rejects absolute paths, traversal, duplicate IDs, missing or non-M4A files, files over 1 MB, recordings over 60 seconds, blank references, and unknown manifest fields.

## Result contract

Write one timestamped JSON result plus a Markdown summary under `benchmark/results/`:

```json
{
  "schemaVersion": 1,
  "runId": "...",
  "startedAt": "...",
  "models": [
    {
      "provider": "sahara",
      "model": "...",
      "caseId": "pidgin-reminder-01",
      "status": "SUCCESS",
      "transcript": "...",
      "latencyMillis": 1234,
      "wordErrorRate": 0.08,
      "characterErrorRate": 0.03
    }
  ]
}
```

Do not include API keys, authorization headers, raw provider responses, audio bytes, local absolute paths, or stack traces. A failed call records only provider/model, case ID, latency, and a sanitized failure class.

## Metrics

Required ASR metrics:

- Word error rate using normalized reference and candidate transcripts.
- Character error rate.
- Successful-response rate.
- Median and p95 latency.
- Per-tag aggregates for Nigerian English, Pidgin, code-switching, noise, and command type.

Optional semantic metrics may pass every successful transcript through the same VoiceActionDraft v2 proposal provider and compare intent plus normalized slots. They must be labelled separately from ASR scores.

## Ordered implementation

1. Add benchmark types and strict manifest validation.
2. Add `OpenAiTranscriptionProvider` using the existing adapter result types and M4A upload.
3. Instantiate it for `gpt-transcribe` and `whisper-1` in a benchmark-only registry.
4. Add deterministic WER/CER normalization and calculation.
5. Add the bounded benchmark runner and sanitized result writer. Default concurrency is one case per provider; `--concurrency` may raise it to at most three.
6. Add `pnpm benchmark:voice -- --manifest <path> --out <directory>`. Exit `0` only when the manifest is valid and every configured provider produced a result row for every case; individual provider failures remain rows rather than aborting the run.
7. Add mocked adapter, manifest, metric, failure-isolation, and no-production-fallback tests.
8. Run a small dry-run fixture through mock transports.
9. Run the consented corpus against all three live providers.
10. Record model identifiers, timestamps, corpus version, and final aggregate evidence in the contest documentation.

## Required automated evidence

- Production provider selection returns Sahara and never benchmark providers.
- Server startup and `/v1/voice/propose` do not require `OPENAI_API_KEY`.
- Both OpenAI model IDs use the same adapter and preserve the selected ID.
- All three providers receive byte-identical M4A input.
- A provider timeout or failure cannot abort the other benchmark calls.
- Manifest traversal and malformed cases are rejected.
- WER/CER fixtures cover exact, insertion, deletion, and substitution cases.
- Results contain no secrets, headers, raw audio, absolute paths, or raw errors.
- No Prisma writes occur during benchmark runs.
- Existing voice v1/v2, auth, refresh, idempotency, typecheck, and build evidence remains green.

## Exit criteria

The benchmark increment is complete only when the automated evidence passes and one consented corpus run produces comparable Sahara, `gpt-transcribe`, and `whisper-1` results. Production remains Sahara-only regardless of benchmark ranking; changing production provider requires a separate explicit decision.

## Provider references

- OpenAI GPT-Transcribe: https://developers.openai.com/api/docs/models/gpt-transcribe
- OpenAI Whisper: https://developers.openai.com/api/docs/models/whisper-1
