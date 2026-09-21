import type { VoiceActionDraftV2 } from '../contracts/voiceV2';
import type { ProposalRequest, VoiceProposalProvider } from './types';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = process.env.VOICE_PROPOSAL_MODEL ?? 'gemini-2.0-flash';
const TIMEOUT_MS = 20_000;
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

const SYSTEM_PROMPT = `You convert a spoken voice transcript into one JSON VoiceActionDraft for Tochi.
You have no tools, no user data, no task list, and no calendar.
You cannot save, schedule, approve, or execute anything.

Respond with ONLY a JSON object matching schemaVersion 2. No markdown.

Required fields:
- schemaVersion: always 2
- utteranceId: echo the provided utteranceId exactly
- intent: one of CREATE_TASK, CREATE_REMINDER, COMPLETE_TASK, RESCHEDULE_TASK, LIST_TODAY, START_TIMER, PLAN_GOAL, CREATE_SERIES, UNKNOWN
- originalTranscript: the transcript

Optional fields by intent (omit unrelated fields):
- CREATE_TASK / CREATE_REMINDER: proposedTitle, proposedNotes, temporal, category, priority
- COMPLETE_TASK: targetQuery
- RESCHEDULE_TASK: targetQuery, temporal
- LIST_TODAY: none
- START_TIMER: timerDurationMillis, timerLabel, timerDeliveryMode (BANNER|ALARM)
- PLAN_GOAL: proposedTitle, proposedNotes, proposedGoalTasks[{title, temporal?, category?, priority?}]
- CREATE_SERIES: proposedTitle, proposedNotes, category, priority, series{ruleKind, interval, weekdaysMask, monthlyDay, localTimeMinute, startEpochDay, endMode, endEpochDay?, endCount?, reminderEnabled, reminderMode}
- UNKNOWN: none

temporal uses kind ABSOLUTE|RELATIVE|UNSPECIFIED with optional year/month/day/hour/minute/relativeMillis/originalPhrase/ambiguous/past.
Preserve date-only phrases: if the user gave a date without a clock time, omit hour and minute.
Never invent times, titles, or targets that were not spoken.
Never include approval or execute fields.
category is STUDY|WORK|PERSONAL|UNSPECIFIED. priority is LOW|MEDIUM|HIGH.
series.reminderMode is APP or ALARM only.
If unsafe/destructive/unclear, return intent UNKNOWN with ambiguous true.`;

export type ProposalFailureCategory = 'RATE_LIMITED' | 'TIMEOUT' | 'PROVIDER_FAILURE';

export class ProposalProviderError extends Error {
  constructor(readonly category: ProposalFailureCategory) {
    super(category);
    this.name = 'ProposalProviderError';
  }
}

export function classifyProposalFailure(error: unknown): ProposalFailureCategory {
  if (error instanceof ProposalProviderError) return error.category;
  if (typeof error === 'object' && error !== null) {
    const status = 'status' in error ? error.status : undefined;
    if (status === 429) return 'RATE_LIMITED';
    if (status === 408 || status === 504) return 'TIMEOUT';
  }
  return 'PROVIDER_FAILURE';
}

/** Sahara transcript → Gate 8J schema v2 proposal; never synthesize a draft on Gemini failure. */
export class LlmProposalProvider implements VoiceProposalProvider {
  readonly providerName = 'llm-proposal-v2';

  async propose(request: ProposalRequest): Promise<VoiceActionDraftV2> {
    if (!genAI) {
      throw new ProposalProviderError('PROVIDER_FAILURE');
    }
    const bounded = request.transcript.trim().slice(0, 4_000);
    const captured = Number.isFinite(request.capturedAtMillis)
      ? new Date(request.capturedAtMillis).toISOString()
      : 'unknown';
    const zone = /^[A-Za-z0-9_+\-/]{1,64}$/.test(request.timeZoneId)
      ? request.timeZoneId
      : 'unspecified';
    const userText =
      `utteranceId=${request.utteranceId}\n` +
      `Spoken at ${captured} in timezone ${zone}. Extract spoken phrases only; do not invent deadlines.\n\n` +
      `Transcript:\n${bounded}`;

    try {
      const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 1024,
        },
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ProposalProviderError('TIMEOUT')), TIMEOUT_MS);
      });
      const result = await Promise.race([model.generateContent(userText), timeout])
        .finally(() => { if (timer) clearTimeout(timer); });
      const text = result.response.text();
      const parsed = JSON.parse(text) as VoiceActionDraftV2;
      return {
        ...parsed,
        schemaVersion: 2,
        utteranceId: request.utteranceId,
        originalTranscript: bounded,
      };
    } catch (error) {
      throw new ProposalProviderError(classifyProposalFailure(error));
    }
  }
}
