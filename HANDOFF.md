# Gate 8J voice gateway — receiving-engineer handoff

**Prepared:** 2026-09-21. **Base:** `origin/main` at `14640dc` (merged PR #1, which already supplied the v2 contract, installation refresh rotation, and baseline route tests). This PR contains only follow-up work not already in that merge. **Gate 8J is NOT ACCEPTED.**

## Authority and integration contract

Read the Android repository's `docs/focus/CURRENT_STATE.md`, `FOCUS_SERIES_CONTRACT.md`, `GATE_8J_PLAN.md` (freeze `ed32ed8`), and relevant `ACCEPTANCE_EVIDENCE.md`. The accepted §3a amendment authorizes a separate spoken-approval transcription request. Do not replace these with an interpretation of this handoff.

- Proposal: authenticated `POST /v1/voice/propose`, multipart `audio` + strict `metadata`, contract/schema **v2**, raw `VoiceActionDraftV2`. The backend proposes only; Android owns confirmation and mutations.
- Spoken approval: a **different** recording to `POST /v1/voice/transcribe` with `parse=false`, yielding transcript-only. `parse=true` is not a legacy schema-v1 proposal path. The gateway never approves or executes.
- Android accepts only a bare whole-phrase spoken “yes” for an active, unexpired, unchanged confirmation after canonical TTS read-back. The backend must not infer approval from a transcript or return a canned action after provider failure.
- `CREATE_SERIES` persistence, occurrences, reminders, warnings, and Home/Calendar visibility are Android/Room outcomes; a gateway 200 or UI success message does not prove them.
- Local HTTP/debug/ADB evidence does not satisfy the contest/release HTTPS proof in J8-07 or staging physical E2E in J8-19. Do not declare Gate 8J accepted without both and independent final review.

## What this follow-up branch changes

| Area | Files | Behavior |
|---|---|---|
| Proposal fail-closed | `src/providers/llmProposalProvider.ts`, `src/providers/index.ts`, `src/routes/voice.ts` | Sahara transcript goes to Gemini in `auto`/`llm` proposal mode. A missing key, provider exception, timeout, or rate limit does **not** return a mock draft. Fixed safe error categories map to 502/504/429. Explicit `VOICE_PROPOSAL_PROVIDER_MODE=mock` is the only canned proposal mode. |
| Android MPEG-4/AAC compatibility | `src/lib/uploadValidation.ts`, `src/routes/voice.ts` | Preserves byte sniffing and the merged M4A validation. A generic `video/mp4` byte signature is merely a candidate: parsed metadata must show audio-only AAC, positive channel/sample-rate, and valid duration before normalizing to `audio/mp4`. The `/propose` route still enforces 1 MB multipart size, 60-second duration, and declared-vs-detected MIME. Other video formats remain rejected. |
| Approval transcription | `src/routes/voice.ts` | `/transcribe` returns transcript-only regardless of `parse`; `parse=false` is the authorized approval use. Detected MIME is forwarded to the speech provider, not blindly taken from client Content-Type. |
| Bounded provider time | `src/routes/voice.ts` | One 145-second route budget covers speech and, for `/propose`, proposal generation. The Gemini provider also has a 20-second deadline. No automatic provider retry occurs inside the request. |
| Documentation/tests | `README.md`, `test/proposalFailure.test.ts`, `test/uploadValidation.test.ts` | Documents provider selection, explicit local `.env` loading, Gate 8J route split, and safe failures. Adds focused failure/format tests alongside merged route/contract/idempotency tests. |

The merged baseline's `src/contracts/voiceV2.ts`, strict v2 golden fixtures, atomic failed-key re-reservation, refresh rotation, and existing tests were **preserved**, not copied from the older dirty checkout. In particular, a matching `FAILED` idempotency record may be atomically re-reserved by the merged implementation; `PROCESSING` returns 409 `REQUEST_IN_PROGRESS`, `COMPLETED` returns 409 `ALREADY_PROCESSED`, and a different fingerprint returns 409 `IDEMPOTENCY_CONFLICT`. A caught Prisma P2002 log alone does not identify the original failure.

## Local development setup and security

- Development gateway uses the existing PostgreSQL 16/database and checked-in Prisma migrations. Reuse them; do not drop/reset databases, modify unrelated roles, or touch production data. `/health` proves the HTTP listener, **not** database or provider readiness.
- The local gateway `.env` is intended configuration and remains ignored. `src/server.ts` does not explicitly load it; for a direct local run use `node --env-file=.env --import tsx src/server.ts` from the gateway directory. Never print values. Provider credentials, JWT/fingerprint/admin secrets, refresh credentials, audio, and transcripts must not enter logs, issues, PR descriptions, or commits.
- Physical debug Android can reach `http://127.0.0.1:3000` using `adb reverse tcp:3000 tcp:3000`; forwarding may disappear after a reconnect. Cleartext is debug-only. Do not represent this as HTTPS staging.
- The original local checkout has untracked `.env.bak`, `nano.env`, and `docker-compose.yml.backup`. Their contents were **not opened for this handoff** and they must **not** be bulk-staged. This PR branch was created from `origin/main` in an isolated worktree to avoid those files and preserve the running development checkout.

## Observed live history (not acceptance evidence)

1. On an earlier SM_G991U upload, Android declared `audio/mp4`, but byte sniffing reported `video/mp4`; the old allowlist returned `UNSUPPORTED_AUDIO` before Sahara/proposal. The narrow audio-only AAC correction is code-tested but a fresh actual device upload still needs metadata-only confirmation of detected type, parsed codec/duration, and provider MIME/filename. Do not use a converted sample as device evidence.
2. The Android app later reported “voice unavailable.” Gateway `installation.findUnique` showed PostgreSQL at `localhost:5432` was offline. PostgreSQL 16 was started and readiness later showed “accepting connections.” A subsequent no-status auth refresh failure was resolved after reconnecting local gateway access/ADB forwarding. These were environment blockers, not proposal verification.
3. A real speech transcript was paired with an unrelated canned proposal matching `MockProposalProvider`. Inspection found the previous Gemini provider silently returned mock data on error; this PR makes that path fail closed. The incorrect proposal must never be confirmed. The private transcript is intentionally omitted here.
4. After a code fix and gateway restart, the user reported “failed to process” for the first fresh attempt, but its exact HTTP status/error code was **not captured**. A later attempt emitted Prisma P2002 on `(installationId,idempotencyKey)`. The merged reservation code intentionally catches unique-key races; determine whether this was a retry with the same key, a 409, or another response. Do not delete request rows or reset the app/database to mask it.
5. There is **no verified live** correct post-fix proposal, CREATE_SERIES confirmation, separate approval transcription, bare-“yes” execution, persisted series/occurrences/reminder, Home/Calendar visibility, rejection/cancellation non-mutation, or duplicate-approval outcome. HTTPS staging URL/credentials and J8-07/J8-19 evidence are still outstanding.

## Verification on this reconciled branch

```text
pnpm prisma:generate       PASS (generated client only; no DB mutation)
pnpm exec tsc --noEmit     PASS
pnpm test                  PASS: 7 files, 43 tests
git diff --check           PASS
```

These checks cover contract/route/auth/idempotency behavior plus the new fail-closed and upload-format unit cases. They do not prove provider quality or device E2E. Run the full suite again after any changes. Do not copy secret `.env` files into an isolated test worktree.

## Suggested next investigation

1. Reproduce the first `/propose` failure with a **new** recording/utterance. Capture only the HTTP status, stable error code, provider failure category, and scoped request-record status; never log bytes, transcript, API response body, Authorization, or credentials. Identify whether Sahara, Gemini transport/quota/model, JSON parse, validation, or a deadline failed. Preserve fail-closed behavior.
2. Verify real device MPEG-4/AAC acceptance through the running gateway, including byte-detected MIME, parsed track codec/duration, normalized provider MIME/filename, and schema-v2 response. Keep diagnostics metadata-only.
3. Once the proposal is correct, test canonical TTS completion and the separate `parse=false` approval turn. Compare Android database state before/after **each** positive and negative case: one persisted series with generated occurrences and applicable reminder/warning, visible in Home/Calendar; “no”/cancel causes no new mutation; repeated approval causes no second series. Use deltas, not absolute zero counts after success.
4. Obtain authorized HTTPS contest/staging configuration and capture exact J8-07/J8-19 evidence. Local HTTP cannot close those criteria. Then request independent J8-20 review. Gate 8J remains **NOT ACCEPTED** until all required evidence exists.
