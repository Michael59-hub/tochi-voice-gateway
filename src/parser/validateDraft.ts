import { VoiceActionDraft, SCHEMA_VERSION, Intent } from './types';

// Required fields per intent — an emitted draft missing any of these
// is invalid and must return draftError rather than reach Review as
// executable data (Step 4.4's exit criteria, verbatim).
const REQUIRED_FIELDS: Record<Intent, (keyof VoiceActionDraft)[]> = {
  CREATE_TASK: ['title'],
  CREATE_REMINDER: ['title', 'rawTimePhrase'],
  COMPLETE_TASK: ['targetQuery'],
  RESCHEDULE_TASK: ['targetQuery', 'rawTimePhrase'],
  LIST_TODAY: [],
  START_TIMER: ['timerDurationRawPhrase'],
  PLAN_GOAL: ['planSteps'],
  UNKNOWN: [],
};

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateDraft(draft: unknown): ValidationResult {
  if (typeof draft !== 'object' || draft === null) {
    return { valid: false, reason: 'Draft is not an object' };
  }

  const d = draft as Partial<VoiceActionDraft>;

  if (d.schemaVersion !== SCHEMA_VERSION) {
    return { valid: false, reason: `Unsupported schemaVersion: ${d.schemaVersion}` };
  }

  if (!d.intent || !(d.intent in REQUIRED_FIELDS)) {
    return { valid: false, reason: `Unknown or missing intent: ${d.intent}` };
  }

  const required = REQUIRED_FIELDS[d.intent];
  for (const field of required) {
    const value = d[field];
    const missing =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim().length === 0) ||
      (Array.isArray(value) && value.length === 0);

    if (missing) {
      return { valid: false, reason: `Missing required field "${field}" for intent ${d.intent}` };
    }
  }

  return { valid: true };
}