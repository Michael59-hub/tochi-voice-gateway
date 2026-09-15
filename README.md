# Tochi Voice Gateway

An Express and Prisma service for managing device installations, issuing credentials, and processing bounded voice transcription requests.

## Current scope

Implemented:

- `GET /health`
- Installation registration for Android and iOS
- Access-token authentication with 15-minute JWTs
- Refresh-credential rotation and installation lookup/revocation
- Authenticated audio transcription with request metadata validation
- Android-compatible contract-v2 voice proposals
- Audio signature validation, a 5 MB upload limit, and M4A container-duration validation
- Per-installation and global concurrency limits, daily quota limits, and an in-memory emergency disable switch
- Idempotency-key reservation and request-status polling
- Pluggable mock and Sahara transcription providers, including multipart requests to Intron's synchronous upload API
- PostgreSQL persistence through Prisma

The current implementation is intentionally single-process in a few places: concurrency counters, the voice disable switch, and provider selection are held in application memory. Audio request results are not cached.

## Requirements

- Node.js 20 or newer
- pnpm 12.3.4
- PostgreSQL 16 or newer

The repository declares pnpm through Corepack. Enable it once if needed:

```bash
corepack enable
corepack prepare pnpm@12.3.4 --activate
```

## Configuration

Create a `.env` file in the project root:

```dotenv
DB_USER=tochi
DB_PASSWORD=change-me
DB_NAME=tochi_voice
DB_PORT=5432
DATABASE_URL=postgresql://tochi:change-me@localhost:5432/tochi_voice?schema=public
JWT_SIGNING_SECRET=replace-with-a-long-random-secret
REQUEST_FINGERPRINT_SECRET=replace-with-a-different-long-random-secret
ADMIN_API_SECRET=replace-with-an-admin-secret
VOICE_PROVIDER_MODE=mock
SAHARA_API_URL=https://example.invalid
SAHARA_API_KEY=replace-when-using-sahara
PORT=3000
ADMIN_PORT=4000
```

`DATABASE_URL`, `JWT_SIGNING_SECRET`, `REQUEST_FINGERPRINT_SECRET`, `ADMIN_API_SECRET`, `VOICE_PROVIDER_MODE`, `PORT`, and `ADMIN_PORT` are used by the application. `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and `DB_PORT` are used by Docker Compose and should match the local database connection in `DATABASE_URL`. `SAHARA_API_URL` and `SAHARA_API_KEY` are required only when `VOICE_PROVIDER_MODE=sahara`.

The server loads `.env` automatically when it starts.

Do not commit `.env` or expose any signing, fingerprint, admin, or provider secret. Refresh credentials are returned only at registration or refresh time and should be stored securely by the client. The admin API binds to `127.0.0.1` and requires `X-Admin-Secret`.

## Local development

Install dependencies, start PostgreSQL, generate the Prisma client, and apply the development migration:

```bash
pnpm install
docker compose up -d postgres
pnpm prisma:generate
pnpm prisma:migrate
```

Start the development server with automatic restart:

```bash
pnpm dev
```

The service listens on `http://localhost:3000` by default. For a production-style run:

```bash
pnpm build
pnpm start
```

## Docker Compose

Docker Compose starts PostgreSQL and the application together. Set the variables used by `docker-compose.yml` in `.env`, then run:

```bash
docker compose up --build
```

The application container starts the compiled server and does not run migrations automatically. Apply pending migrations from the application image after PostgreSQL is healthy:

```bash
docker compose up -d postgres
docker compose run --rm app pnpm exec prisma migrate deploy
docker compose up app
```

The current Compose file passes the database URL, JWT secret, and public port to the app container. Pass `ADMIN_API_SECRET`, `REQUEST_FINGERPRINT_SECRET`, and the provider variables through the Compose environment as well when using the containerized app; the admin listener is not published by default.

Stop the stack with:

```bash
docker compose down
```

Add `-v` only when you intentionally want to remove the PostgreSQL data volume.

## API

### Health check

```bash
curl http://localhost:3000/health
```

Response:

```json
{"status":"ok"}
```

### Register an installation

```bash
curl -X POST http://localhost:3000/v1/installations/register \
  -H 'Content-Type: application/json' \
  -d '{"platform":"ANDROID"}'
```

`platform` must be `ANDROID` or `IOS`. A successful response contains an installation ID, an access token, a refresh credential, and the initial `UNVERIFIED` quota tier:

```json
{
  "installationId": "...",
  "accessToken": "...",
  "accessTokenExpiresAtEpochMs": 1789030282000,
  "refreshCredential": "...",
  "quotaTier": "UNVERIFIED"
}
```

### Refresh credentials

```bash
curl -X POST http://localhost:3000/v1/installations/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshCredential":"..."}'
```

Refreshing rotates the credential. Replace the stored refresh credential with the one returned by this endpoint. Access tokens remain valid for 15 minutes and the response includes `accessTokenExpiresAtEpochMs`. The immediately previous refresh credential has a two-minute, race-safe recovery window for a client that crashes before persisting the rotated value. A missing, expired, invalid, or revoked credential returns `401`.

### Get the current installation

```bash
curl http://localhost:3000/v1/installations/me \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

### Revoke the current installation

```bash
curl -X DELETE http://localhost:3000/v1/installations/me \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Successful revocation returns `204 No Content`. The access-token middleware returns `401` when the bearer token is missing, invalid, or expired.

### Transcribe audio

Send a `multipart/form-data` request with an `audio` file and a JSON `meta` field. The request must include an `Idempotency-Key` and an installation access token:

```bash
curl -X POST http://localhost:3000/v1/voice/transcribe \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Idempotency-Key: request-123' \
  -F 'audio=@recording.m4a;type=audio/mp4' \
  -F 'meta={"schemaVersion":1,"capturedAtEpochMs":1760000000000,"timezone":"UTC","languageHint":"en-US","parse":true}'
```

Supported detected audio formats are MP4/M4A, WAV, OGG, and MP3. The metadata requires `schemaVersion: 1`, `capturedAtEpochMs`, `timezone`, and a boolean `parse`. An optional `languageHint` can be passed to the provider. A successful response contains the transcript, provider name, and a request ID; when `parse` is true it also contains the current draft reminder shape.

The endpoint returns `400` for missing idempotency keys or audio, `415` for unsupported audio, `422` for invalid metadata, `409` for idempotency conflicts or duplicate/in-progress requests, `429` for quota/concurrency limits, `502` for provider failures, and `503` when voice processing is disabled. The default `UNVERIFIED` tier allows one concurrent request and 20 requests per day; the `VERIFIED` tier allows three concurrent requests and 200 requests per day. The process-wide provider concurrency limit is 10.

### Propose an Android voice action (contract v2)

`POST /v1/voice/propose` uses the same installation bearer authentication, quota controls, audio validation, and server-selected speech provider as `/transcribe`. It accepts multipart parts named `audio` and `metadata`; normal audio, transcripts, and proposal drafts are not persisted.

The `metadata` part is strict JSON:

```json
{
  "contractVersion": 2,
  "utteranceId": "4bd4be90-7832-4bf4-9893-bf777bf6c72b",
  "idempotencyKey": "4bd4be90-7832-4bf4-9893-bf777bf6c72b",
  "capturedAtMillis": 1789372800000,
  "timeZoneId": "Africa/Lagos",
  "mimeType": "audio/mp4",
  "container": "mpeg4",
  "encoder": "aac",
  "channelCount": 1,
  "sampleRateHz": 16000,
  "durationMillis": 4200,
  "sizeBytes": 84217
}
```

The metadata idempotency key must equal the `Idempotency-Key` header. Audio is limited to 1 MB and 60 seconds. This v2 endpoint accepts Tochi's Android format: AAC in an MPEG-4/M4A container (`audio/mp4`, `.m4a`); its signature and MP4 container duration are validated. The v1 `/transcribe` endpoint retains its broader format support. Success is a raw `VoiceActionDraft` v2 object, not a response wrapper:

```json
{
  "schemaVersion": 2,
  "utteranceId": "4bd4be90-7832-4bf4-9893-bf777bf6c72b",
  "intent": "CREATE_TASK",
  "originalTranscript": "add buy milk",
  "proposedTitle": "Buy milk",
  "category": "PERSONAL",
  "priority": "MEDIUM",
  "ambiguous": false
}
```

Supported intents are `CREATE_TASK`, `CREATE_REMINDER`, `COMPLETE_TASK`, `RESCHEDULE_TASK`, `LIST_TODAY`, `START_TIMER`, `PLAN_GOAL`, `CREATE_SERIES`, and `UNKNOWN`. The backend returns proposal text only and never returns task, reminder, timer, or series IDs.

Idempotency records remain content-free. Matching `PROCESSING` requests return `409 REQUEST_IN_PROGRESS`; matching `COMPLETED` requests return `409 ALREADY_PROCESSED`; matching `FAILED` requests may be atomically processed again; and a different fingerprint under the same key returns `409 IDEMPOTENCY_CONFLICT`.

Stable v2 errors include `INVALID_METADATA` (422), `INVALID_PROPOSAL` (422), `AUDIO_TOO_LARGE` (413), `UNSUPPORTED_AUDIO` (415), `RATE_LIMITED` (429), `PROVIDER_TIMEOUT` (504), and sanitized `PROVIDER_FAILURE` (502).

### Check request status

```bash
curl http://localhost:3000/v1/voice/requests/request-123/status \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Returns `PROCESSING`, `COMPLETED`, or `FAILED`. Completed responses do not repeat the transcript or draft.

### Admin voice switch

The admin API listens on `127.0.0.1:4000` by default and is not exposed by the public Express app. It requires the configured `X-Admin-Secret` header:

```bash
curl -X POST http://127.0.0.1:4000/v1/admin/voice/disable \
  -H 'X-Admin-Secret: ADMIN_API_SECRET'

curl -X POST http://127.0.0.1:4000/v1/admin/voice/enable \
  -H 'X-Admin-Secret: ADMIN_API_SECRET'
```

The switch affects the current process only.

### Provider selection

`VOICE_PROVIDER_MODE=mock` is the default and returns deterministic mock transcription data. `/propose` then uses the server-side deterministic mock proposal provider for local Android integration. Set `VOICE_PROVIDER_MODE=sahara` and provide `SAHARA_API_URL` and `SAHARA_API_KEY` to call the Sahara transcription adapter; a production proposal provider remains future work.

The Sahara adapter sends the original audio filename, MIME type, and audio bytes as a multipart request. It passes `languageHint` through to Intron and defaults to `en` when no language hint is provided. The client-side timeout is 125 seconds to accommodate Intron's synchronous processing window. HTTP 400, 429, and 503 responses are mapped to unsupported-input, rate-limit, and timeout provider failures respectively; other non-success responses are returned as provider failures.

Sahara remains the production speech provider. A separate, non-production comparison of Sahara, OpenAI `gpt-transcribe`, and OpenAI `whisper-1` is specified in [`docs/VOICE_BENCHMARK_PLAN.md`](docs/VOICE_BENCHMARK_PLAN.md); benchmark providers must never become runtime fallbacks for ordinary Android requests.

### HTTP request collections

The `Tests/` directory contains secret-free OpenCollection requests for registration, token refresh, status checks, authenticated transcription, v2 proposal calls, and direct Intron adapter testing. Supply credentials through the local environment and provide a local audio fixture. WAV fixtures placed directly in `Tests/` are ignored by Git. For the v2 manual request, update `sizeBytes` to the exact selected file size.

## Project commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the development server with reloads |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm test` | Run the automated contract, route, idempotency, and refresh tests |
| `pnpm start` | Run the compiled server |
| `pnpm prisma:generate` | Generate the Prisma client |
| `pnpm prisma:migrate` | Create/apply a development migration |

## License

This project currently uses the ISC license declared in `package.json`.
