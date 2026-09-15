import { ProposalRequest, VoiceProposalProvider } from './types';
import { VoiceActionDraftV2 } from '../contracts/voiceV2';

export class MockProposalProvider implements VoiceProposalProvider {
  readonly providerName = 'mock-proposal';

  async propose(request: ProposalRequest): Promise<VoiceActionDraftV2> {
    const text = request.transcript.trim();
    const normalized = text.toLowerCase();
    const base = {
      schemaVersion: 2 as const,
      utteranceId: request.utteranceId,
      originalTranscript: text,
      ambiguous: false,
    };

    if (normalized.includes('every monday') && normalized.includes('wednesday') && normalized.includes('friday')) {
      return {
        ...base,
        intent: 'CREATE_SERIES',
        proposedTitle: 'Plan my day',
        proposedNotes: 'weekday planning',
        category: 'PERSONAL',
        priority: 'MEDIUM',
        series: {
          ruleKind: 'WEEKLY', interval: 1, weekdaysMask: 37, monthlyDay: 1,
          localTimeMinute: 540, startEpochDay: 20339, endMode: 'NEVER',
          reminderEnabled: true, reminderMode: 'APP',
        },
      };
    }
    if (normalized.includes('plan my study night')) {
      return {
        ...base,
        intent: 'PLAN_GOAL',
        proposedTitle: 'Study night',
        proposedGoalTasks: [
          { title: 'Review notes', category: 'STUDY', priority: 'HIGH' },
          { title: 'Practice problems', category: 'STUDY', priority: 'MEDIUM' },
        ],
      };
    }
    if (normalized.includes('timer')) {
      return { ...base, intent: 'START_TIMER', timerDurationMillis: 300_000, timerLabel: 'Tea', timerDeliveryMode: 'ALARM' };
    }
    if (normalized.includes('on today')) {
      return { ...base, intent: 'LIST_TODAY' };
    }
    if (normalized.startsWith('move ')) {
      return {
        ...base,
        intent: 'RESCHEDULE_TASK',
        targetQuery: 'Buy milk',
        temporal: { kind: 'RELATIVE', relativeMillis: 86_400_000, hour: 10, minute: 0, originalPhrase: 'tomorrow at 10', ambiguous: false, past: false },
      };
    }
    if (normalized.startsWith('mark ')) {
      return { ...base, intent: 'COMPLETE_TASK', targetQuery: 'Buy milk' };
    }
    if (normalized.startsWith('remind ')) {
      return {
        ...base,
        intent: 'CREATE_REMINDER',
        proposedTitle: 'Call mom',
        temporal: { kind: 'RELATIVE', relativeMillis: 86_400_000, hour: 9, minute: 0, originalPhrase: 'tomorrow at 9am', ambiguous: false, past: false },
        category: 'PERSONAL',
        priority: 'HIGH',
      };
    }
    if (normalized.startsWith('add ')) {
      return { ...base, intent: 'CREATE_TASK', proposedTitle: 'Buy milk', category: 'PERSONAL', priority: 'MEDIUM' };
    }
    return { ...base, intent: 'UNKNOWN', ambiguous: true };
  }
}
