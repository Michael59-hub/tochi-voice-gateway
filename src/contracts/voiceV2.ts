export const VOICE_V2_CONTRACT_VERSION = 2 as const;
export const VOICE_V2_SCHEMA_VERSION = 2 as const;

export const VOICE_INTENTS = [
  'CREATE_TASK',
  'CREATE_REMINDER',
  'COMPLETE_TASK',
  'RESCHEDULE_TASK',
  'LIST_TODAY',
  'START_TIMER',
  'PLAN_GOAL',
  'CREATE_SERIES',
  'UNKNOWN',
] as const;

export type VoiceIntentV2 = (typeof VOICE_INTENTS)[number];
export type VoiceCategoryV2 = 'STUDY' | 'WORK' | 'PERSONAL' | 'UNSPECIFIED';
export type VoicePriorityV2 = 'LOW' | 'MEDIUM' | 'HIGH';

export interface VoiceProposeMetadataV2 {
  contractVersion: 2;
  utteranceId: string;
  idempotencyKey: string;
  capturedAtMillis: number;
  timeZoneId: string;
  mimeType: string;
  container: string;
  encoder: string;
  channelCount: number;
  sampleRateHz: number;
  durationMillis: number;
  sizeBytes: number;
}

export interface TemporalProposalV2 {
  kind?: 'ABSOLUTE' | 'RELATIVE' | 'UNSPECIFIED';
  epochMillis?: number;
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  relativeMillis?: number;
  originalPhrase?: string;
  ambiguous?: boolean;
  past?: boolean;
}

export interface VoiceSeriesProposalV2 {
  ruleKind: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  interval?: number;
  weekdaysMask?: number;
  monthlyDay?: number;
  localTimeMinute: number;
  startEpochDay: number;
  endMode?: 'NEVER' | 'ON_DATE' | 'AFTER_COUNT';
  endEpochDay?: number;
  endCount?: number;
  reminderEnabled?: boolean;
  reminderMode?: 'APP' | 'ALARM';
}

export interface ProposedGoalTaskV2 {
  title: string;
  temporal?: TemporalProposalV2;
  category?: VoiceCategoryV2;
  priority?: VoicePriorityV2;
}

export interface VoiceActionDraftV2 {
  schemaVersion: 2;
  utteranceId: string;
  intent: VoiceIntentV2;
  originalTranscript: string;
  proposedTitle?: string;
  proposedNotes?: string;
  temporal?: TemporalProposalV2;
  category?: VoiceCategoryV2;
  priority?: VoicePriorityV2;
  targetQuery?: string;
  timerDurationMillis?: number;
  timerLabel?: string;
  timerDeliveryMode?: 'BANNER' | 'ALARM';
  proposedGoalTasks?: ProposedGoalTaskV2[];
  series?: VoiceSeriesProposalV2;
  confidence?: number;
  ambiguous?: boolean;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const METADATA_KEYS = new Set([
  'contractVersion', 'utteranceId', 'idempotencyKey', 'capturedAtMillis', 'timeZoneId',
  'mimeType', 'container', 'encoder', 'channelCount', 'sampleRateHz', 'durationMillis', 'sizeBytes',
]);
const DRAFT_KEYS = new Set([
  'schemaVersion', 'utteranceId', 'intent', 'originalTranscript', 'proposedTitle', 'proposedNotes',
  'temporal', 'category', 'priority', 'targetQuery', 'timerDurationMillis', 'timerLabel',
  'timerDeliveryMode', 'proposedGoalTasks', 'series', 'confidence', 'ambiguous',
]);
const TEMPORAL_KEYS = new Set([
  'kind', 'epochMillis', 'year', 'month', 'day', 'hour', 'minute', 'relativeMillis',
  'originalPhrase', 'ambiguous', 'past',
]);
const SERIES_KEYS = new Set([
  'ruleKind', 'interval', 'weekdaysMask', 'monthlyDay', 'localTimeMinute', 'startEpochDay',
  'endMode', 'endEpochDay', 'endCount', 'reminderEnabled', 'reminderMode',
]);
const GOAL_TASK_KEYS = new Set(['title', 'temporal', 'category', 'priority']);
const COMMON_DRAFT_KEYS = [
  'schemaVersion', 'utteranceId', 'intent', 'originalTranscript', 'confidence', 'ambiguous',
] as const;
const INTENT_DRAFT_KEYS: Record<VoiceIntentV2, readonly string[]> = {
  CREATE_TASK: ['proposedTitle', 'proposedNotes', 'temporal', 'category', 'priority'],
  CREATE_REMINDER: ['proposedTitle', 'proposedNotes', 'temporal', 'category', 'priority'],
  COMPLETE_TASK: ['targetQuery'],
  RESCHEDULE_TASK: ['targetQuery', 'temporal'],
  LIST_TODAY: [],
  START_TIMER: ['timerDurationMillis', 'timerLabel', 'timerDeliveryMode'],
  PLAN_GOAL: ['proposedTitle', 'proposedNotes', 'proposedGoalTasks'],
  CREATE_SERIES: ['proposedTitle', 'proposedNotes', 'category', 'priority', 'series'],
  UNKNOWN: [],
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function stringIn(value: unknown, values: readonly string[]): boolean {
  return typeof value === 'string' && values.includes(value);
}

function boundedString(value: unknown, max: number, allowBlank = false): value is string {
  return typeof value === 'string' && value.length <= max && (allowBlank || value.trim().length > 0);
}

function optionalInteger(value: unknown): boolean {
  return value === undefined || Number.isSafeInteger(value);
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function validateVoiceProposeMetadataV2(value: unknown): ValidationResult<VoiceProposeMetadataV2> {
  if (!record(value) || !exactKeys(value, METADATA_KEYS)) return { ok: false, reason: 'shape' };
  if (value.contractVersion !== VOICE_V2_CONTRACT_VERSION) return { ok: false, reason: 'version' };
  if (!boundedString(value.utteranceId, 128) || !boundedString(value.idempotencyKey, 200)) {
    return { ok: false, reason: 'identity' };
  }
  if (!Number.isSafeInteger(value.capturedAtMillis) || (value.capturedAtMillis as number) <= 0) {
    return { ok: false, reason: 'captured_at' };
  }
  if (!boundedString(value.timeZoneId, 100) || !validTimeZone(value.timeZoneId)) {
    return { ok: false, reason: 'timezone' };
  }
  if (!boundedString(value.mimeType, 100) || !boundedString(value.container, 32) ||
      !boundedString(value.encoder, 32)) {
    return { ok: false, reason: 'audio_format' };
  }
  if (!Number.isSafeInteger(value.channelCount) || (value.channelCount as number) < 1 ||
      !Number.isSafeInteger(value.sampleRateHz) || (value.sampleRateHz as number) < 1 ||
      !Number.isSafeInteger(value.durationMillis) || (value.durationMillis as number) < 0 ||
      (value.durationMillis as number) > 60_000 ||
      !Number.isSafeInteger(value.sizeBytes) || (value.sizeBytes as number) < 1 ||
      (value.sizeBytes as number) > 1_000_000) {
    return { ok: false, reason: 'audio_bounds' };
  }
  return { ok: true, value: value as unknown as VoiceProposeMetadataV2 };
}

function validTemporal(value: unknown): value is TemporalProposalV2 {
  if (!record(value) || !exactKeys(value, TEMPORAL_KEYS)) return false;
  if (value.kind !== undefined && !stringIn(value.kind, ['ABSOLUTE', 'RELATIVE', 'UNSPECIFIED'])) return false;
  for (const key of ['epochMillis', 'year', 'month', 'day', 'hour', 'minute', 'relativeMillis']) {
    if (!optionalInteger(value[key])) return false;
  }
  if (value.originalPhrase !== undefined && !boundedString(value.originalPhrase, 500, true)) return false;
  return optionalBoolean(value.ambiguous) && optionalBoolean(value.past);
}

function validSeries(value: unknown): value is VoiceSeriesProposalV2 {
  if (!record(value) || !exactKeys(value, SERIES_KEYS)) return false;
  if (!stringIn(value.ruleKind, ['DAILY', 'WEEKLY', 'MONTHLY'])) return false;
  if (!Number.isSafeInteger(value.localTimeMinute) || (value.localTimeMinute as number) < 0 ||
      (value.localTimeMinute as number) > 1439 || !Number.isSafeInteger(value.startEpochDay)) return false;
  const interval = value.interval ?? 1;
  const mask = value.weekdaysMask ?? 0;
  const monthlyDay = value.monthlyDay ?? 1;
  if (!Number.isSafeInteger(interval) || (interval as number) < 1 ||
      !Number.isSafeInteger(mask) || (mask as number) < 0 || (mask as number) > 0b111_1111 ||
      !Number.isSafeInteger(monthlyDay) || (monthlyDay as number) < 1 || (monthlyDay as number) > 31) return false;
  if (value.ruleKind === 'WEEKLY') {
    const weekdayBit = ((value.startEpochDay as number) + 3) % 7;
    const normalizedBit = weekdayBit < 0 ? weekdayBit + 7 : weekdayBit;
    if ((mask as number) === 0 || ((mask as number) & (1 << normalizedBit)) === 0) return false;
  }
  const endMode = value.endMode ?? 'NEVER';
  if (!stringIn(endMode, ['NEVER', 'ON_DATE', 'AFTER_COUNT'])) return false;
  if (endMode === 'NEVER' && (value.endEpochDay !== undefined || value.endCount !== undefined)) return false;
  if (endMode === 'ON_DATE' && (!Number.isSafeInteger(value.endEpochDay) ||
      (value.endEpochDay as number) < (value.startEpochDay as number) || value.endCount !== undefined)) return false;
  if (endMode === 'AFTER_COUNT' && (!Number.isSafeInteger(value.endCount) ||
      (value.endCount as number) < 1 || value.endEpochDay !== undefined)) return false;
  if (!optionalBoolean(value.reminderEnabled)) return false;
  return value.reminderMode === undefined || stringIn(value.reminderMode, ['APP', 'ALARM']);
}

function validGoalTask(value: unknown): value is ProposedGoalTaskV2 {
  if (!record(value) || !exactKeys(value, GOAL_TASK_KEYS) || !boundedString(value.title, 200)) return false;
  if (value.temporal !== undefined && !validTemporal(value.temporal)) return false;
  if (value.category !== undefined && !stringIn(value.category, ['STUDY', 'WORK', 'PERSONAL', 'UNSPECIFIED'])) return false;
  return value.priority === undefined || stringIn(value.priority, ['LOW', 'MEDIUM', 'HIGH']);
}

export function validateVoiceActionDraftV2(
  value: unknown,
  expectedUtteranceId?: string,
): ValidationResult<VoiceActionDraftV2> {
  if (!record(value) || !exactKeys(value, DRAFT_KEYS)) return { ok: false, reason: 'shape' };
  if (value.schemaVersion !== VOICE_V2_SCHEMA_VERSION) return { ok: false, reason: 'version' };
  if (!boundedString(value.utteranceId, 128) ||
      (expectedUtteranceId !== undefined && value.utteranceId !== expectedUtteranceId)) {
    return { ok: false, reason: 'utterance' };
  }
  if (!stringIn(value.intent, VOICE_INTENTS) || !boundedString(value.originalTranscript, 4_000, true)) {
    return { ok: false, reason: 'core' };
  }
  const allowedForIntent = new Set([
    ...COMMON_DRAFT_KEYS,
    ...INTENT_DRAFT_KEYS[value.intent as VoiceIntentV2],
  ]);
  if (!exactKeys(value, allowedForIntent)) return { ok: false, reason: 'intent_fields' };
  if (value.proposedTitle !== undefined && !boundedString(value.proposedTitle, 200)) return { ok: false, reason: 'title' };
  if (value.proposedNotes !== undefined && !boundedString(value.proposedNotes, 4_000, true)) return { ok: false, reason: 'notes' };
  if (value.temporal !== undefined && !validTemporal(value.temporal)) return { ok: false, reason: 'temporal' };
  if (value.category !== undefined && !stringIn(value.category, ['STUDY', 'WORK', 'PERSONAL', 'UNSPECIFIED'])) return { ok: false, reason: 'category' };
  if (value.priority !== undefined && !stringIn(value.priority, ['LOW', 'MEDIUM', 'HIGH'])) return { ok: false, reason: 'priority' };
  if (value.targetQuery !== undefined && !boundedString(value.targetQuery, 200)) return { ok: false, reason: 'target' };
  if (!optionalInteger(value.timerDurationMillis) || (value.timerDurationMillis as number | undefined) === 0) return { ok: false, reason: 'timer' };
  if (value.timerLabel !== undefined && !boundedString(value.timerLabel, 200, true)) return { ok: false, reason: 'timer_label' };
  if (value.timerDeliveryMode !== undefined && !stringIn(value.timerDeliveryMode, ['BANNER', 'ALARM'])) return { ok: false, reason: 'timer_mode' };
  if (value.proposedGoalTasks !== undefined && (!Array.isArray(value.proposedGoalTasks) || !value.proposedGoalTasks.every(validGoalTask))) return { ok: false, reason: 'goal_tasks' };
  if (value.series !== undefined && !validSeries(value.series)) return { ok: false, reason: 'series' };
  if (value.confidence !== undefined && (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1)) return { ok: false, reason: 'confidence' };
  if (!optionalBoolean(value.ambiguous)) return { ok: false, reason: 'ambiguous' };

  switch (value.intent as VoiceIntentV2) {
    case 'CREATE_TASK':
      if (!boundedString(value.proposedTitle, 200)) return { ok: false, reason: 'intent_fields' };
      break;
    case 'CREATE_REMINDER':
      if (!boundedString(value.proposedTitle, 200) || !validTemporal(value.temporal)) return { ok: false, reason: 'intent_fields' };
      break;
    case 'COMPLETE_TASK':
      if (!boundedString(value.targetQuery, 200)) return { ok: false, reason: 'intent_fields' };
      break;
    case 'RESCHEDULE_TASK':
      if (!boundedString(value.targetQuery, 200) || !validTemporal(value.temporal)) return { ok: false, reason: 'intent_fields' };
      break;
    case 'START_TIMER':
      if (!Number.isSafeInteger(value.timerDurationMillis) || (value.timerDurationMillis as number) <= 0) return { ok: false, reason: 'intent_fields' };
      break;
    case 'PLAN_GOAL':
      if (!Array.isArray(value.proposedGoalTasks) || value.proposedGoalTasks.length === 0) return { ok: false, reason: 'intent_fields' };
      break;
    case 'CREATE_SERIES':
      if (!boundedString(value.proposedTitle, 200) || !validSeries(value.series)) return { ok: false, reason: 'intent_fields' };
      break;
    default:
      break;
  }
  return { ok: true, value: value as unknown as VoiceActionDraftV2 };
}
