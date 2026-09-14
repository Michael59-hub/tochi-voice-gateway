import { GoogleGenerativeAI } from '@google/generative-ai';
import { VoiceActionDraft, SCHEMA_VERSION, Intent } from './types';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = 'gemini-3.6-flash';
const TIMEOUT_MS = 8000;

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

console.log('DEBUG: genAI configured?', !!genAI, 'key present?', !!GEMINI_API_KEY);

const VALID_INTENTS: Intent[] = [
  'CREATE_TASK',
  'CREATE_REMINDER',
  'COMPLETE_TASK',
  'RESCHEDULE_TASK',
  'LIST_TODAY',
  'START_TIMER',
  'PLAN_GOAL',
  'UNKNOWN',
];

// The model gets the transcript and nothing else — no tools, no user data,
// no task list. Its only job is to classify intent and extract fields as
// they were spoken. It must never resolve ambiguity or assume context it
// wasn't given (Step 4.4: "the backend cannot see" the user's task list).
const SYSTEM_PROMPT = `You convert a spoken voice transcript into a single JSON object describing the user's intended action. You have no access to any user data, task list, or calendar — only the transcript text.

Respond with ONLY a JSON object, no markdown fences, no preamble, no explanation.

The JSON object must have this shape:
{
  "intent": one of ${JSON.stringify(VALID_INTENTS)},
  "title": string (optional — the task/reminder title, only for CREATE_TASK or CREATE_REMINDER),
  "rawTimePhrase": string (optional — the spoken time phrase exactly as said, e.g. "tomorrow at 8am"),
  "targetQuery": string (optional — spoken search text identifying an existing task, only for COMPLETE_TASK or RESCHEDULE_TASK),
  "timerDurationRawPhrase": string (optional — spoken duration, only for START_TIMER),
  "planSteps": string[] (optional — child steps, only for PLAN_GOAL)
}

Rules:
- Never invent a time, title, duration, or plan step that was not implied by what was actually said.
- Only choose PLAN_GOAL if you can extract at least two concrete, distinct planSteps from the transcript. If the transcript expresses a goal but gives no concrete breakdown (e.g. "plan my exam prep" with no mention of subjects, tasks, or specifics), return {"intent": "UNKNOWN"} instead of PLAN_GOAL with empty or invented steps.
- If the request is destructive (e.g. "delete"), unsafe, or does not match any supported intent, return {"intent": "UNKNOWN"}.
- If the transcript is ambiguous about WHICH task it refers to, still extract targetQuery as spoken — you must never guess which specific task the user means, since you cannot see their task list.
- Only include fields that are relevant to the chosen intent.`;

export async function tryLlmFallbackParse(transcript: string): Promise<VoiceActionDraft | null> {
  if (!genAI) {
    // No key configured — fail closed to UNKNOWN via the caller, not an error.
    return null;
  }

  try {
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json', // Gemini-native structured output mode
        maxOutputTokens: 512,
      },
    });

    const result = await Promise.race([
      model.generateContent(transcript),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('LLM fallback timeout')), TIMEOUT_MS),
      ),
    ]);

    const text = result.response.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Model didn't return valid JSON despite responseMimeType — treat as
      // a parse miss, not a crash. validateDraft() downstream would also
      // catch structurally-wrong output, but failing here avoids passing
      // garbage further down the pipeline.
      return null;
    }

    if (typeof parsed !== 'object' || parsed === null || !('intent' in parsed)) {
      return null;
    }

    const p = parsed as Record<string, unknown>;
    if (typeof p.intent !== 'string' || !VALID_INTENTS.includes(p.intent as Intent)) {
      return null;
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      intent: p.intent as Intent,
      title: typeof p.title === 'string' ? p.title : undefined,
      rawTimePhrase: typeof p.rawTimePhrase === 'string' ? p.rawTimePhrase : undefined,
      targetQuery: typeof p.targetQuery === 'string' ? p.targetQuery : undefined,
      timerDurationRawPhrase:
        typeof p.timerDurationRawPhrase === 'string' ? p.timerDurationRawPhrase : undefined,
      planSteps: Array.isArray(p.planSteps) ? p.planSteps.filter((s) => typeof s === 'string') : undefined,
    };
  } catch(error) {
    // Timeout, rate limit (429), or API failure — fall through to UNKNOWN
    // via the caller rather than throwing and failing the whole
    // /transcribe request. Given the free tier's 10-15 RPM ceiling, a 429
    // here is a real possibility under any real concurrent load — this
    // fail-safe matters more than it would on a paid tier.
    console.error('LLM fallback parse failed:', error);
    return null;
  }
}