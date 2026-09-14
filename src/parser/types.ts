export const SCHEMA_VERSION = 1;

export type Intent =
  | 'CREATE_TASK'
  | 'CREATE_REMINDER'
  | 'COMPLETE_TASK'
  | 'RESCHEDULE_TASK'
  | 'LIST_TODAY'
  | 'START_TIMER'
  | 'PLAN_GOAL'
  | 'UNKNOWN';

// Every field here is a *proposal* — Android's local resolver validates and
// can reject/correct all of it. The backend never sees the user's task list
// and must never claim TARGET_AMBIGUOUS or select among candidates itself.
export interface VoiceActionDraft {
  schemaVersion: typeof SCHEMA_VERSION;
  intent: Intent;
  title?: string;
  rawTimePhrase?: string;
  targetQuery?: string;
  timerDurationRawPhrase?: string;
  planSteps?: string[];
}

export type ParseResult =
  | { kind: 'DRAFT'; draft: VoiceActionDraft }
  | { kind: 'DRAFT_ERROR'; reason: string };