import { Intent, VoiceActionDraft, SCHEMA_VERSION } from './types';

interface Rule {
  intent: Intent;
  pattern: RegExp;
  build: (match: RegExpMatchArray, transcript: string) => Partial<VoiceActionDraft>;
}

// Order matters — more specific patterns must come before general ones.
// Each pattern is intentionally narrow: a miss falls through to the next
// rule, and eventually to the LLM fallback, rather than a rule guessing.
const RULES: Rule[] = [
  // LIST_TODAY — read-only, no fields needed
  {
    intent: 'LIST_TODAY',
    pattern: /\b(what('?s| is| do i have)? (on my|for) (today|today'?s (schedule|agenda))|what do i have to do today|show me today'?s tasks)\b/i,
    build: () => ({}),
  },

  // START_TIMER — "start/set a timer for X minutes/seconds/hours"
  {
    intent: 'START_TIMER',
    pattern: /\b(start|set)\s+(a\s+)?(\d+\s*(minute|min|second|sec|hour|hr)s?)\s*timer\b/i,
    build: (match) => ({
      timerDurationRawPhrase: match[3],
    }),
  },
  {
    intent: 'START_TIMER',
    pattern: /\b(start|set)\s+a\s+timer\s+for\s+(\d+\s*(minute|min|second|sec|hour|hr)s?)\b/i,
    build: (match) => ({
      timerDurationRawPhrase: match[2],
    }),
  },

  // CREATE_REMINDER — "remind me to X [at/on/tomorrow ...]"
  {
    intent: 'CREATE_REMINDER',
    pattern: /\bremind me to (.+?)(?:\s+(tomorrow.*|today.*|on \w+.*|at \d.*|next \w+.*))?$/i,
    build: (match) => ({
      title: match[1].trim(),
      rawTimePhrase: match[2]?.trim(),
    }),
  },

  // RESCHEDULE_TASK — "move/reschedule X to Y"
  {
    intent: 'RESCHEDULE_TASK',
    pattern: /\b(move|reschedule)\s+(?:the\s+)?(.+?)\s+to\s+(.+)$/i,
    build: (match) => ({
      targetQuery: match[2].trim(),
      rawTimePhrase: match[3].trim(),
    }),
  },

  // COMPLETE_TASK — "mark X as done" / "complete X" / "finish X"
  {
    intent: 'COMPLETE_TASK',
    pattern: /\b(mark|complete|finish)\s+(?:the\s+)?(.+?)(?:\s+as\s+(done|complete|finished))?$/i,
    build: (match) => ({
      targetQuery: match[2].trim(),
    }),
  },

  // CREATE_TASK — generic fallback pattern for "add/create a task to X"
  {
    intent: 'CREATE_TASK',
    pattern: /\b(add|create)\s+(?:a\s+)?task\s+(?:to\s+)?(.+)$/i,
    build: (match) => ({
      title: match[2].trim(),
    }),
  },
];

/**
 * Deterministic, rule-based parsing per Step 4.4. Returns null (not
 * UNKNOWN) when nothing matches — the caller decides whether to fall
 * through to the LLM parser or return UNKNOWN directly.
 */
export function tryDeterministicParse(transcript: string): VoiceActionDraft | null {
  const normalized = transcript.trim();

  for (const rule of RULES) {
    const match = normalized.match(rule.pattern);
    if (match) {
      return {
        schemaVersion: SCHEMA_VERSION,
        intent: rule.intent,
        ...rule.build(match, normalized),
      };
    }
  }

  return null;
}