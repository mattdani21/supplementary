import { describe, expect, it } from 'vitest';
import {
  GENERATION_STEPS,
  GENERATION_STATUSES,
  MAX_STEP_ATTEMPTS,
  decideStep,
  isTerminalGenerationStatus,
  permittedGenerationTransitions,
  stepKey,
  transitionGeneration,
  type GenerationStatus,
  type StepRecord,
} from './state-machine.js';

describe('generation steps', () => {
  it('records the claim audit as a first-class step (E24)', () => {
    // The audit_claims step runs per lesson inside the auditing stage, keyed idempotently by
    // hash(lesson) so a retry never re-charges the audit call.
    expect(GENERATION_STEPS).toContain('audit_claims');
    expect(
      stepKey({
        runId: 'run_1',
        step: 'audit_claims',
        subject: 'cur_1_day1',
        inputVersion: 'abc123',
      }),
    ).toBe('run_1:audit_claims:cur_1_day1:abc123');
  });
});

describe('generation state machine', () => {
  it('walks the full pipeline to complete', () => {
    const path: GenerationStatus[] = [
      'ingesting',
      'planning',
      'generating_lessons',
      'generating_assessment',
      'auditing',
      'synthesising_audio',
      'publishing',
      'complete',
    ];
    let status: GenerationStatus = 'queued';
    for (const next of path) {
      const result = transitionGeneration(status, next);
      expect(result.ok, `${status} → ${next}`).toBe(true);
      if (result.ok) status = result.value;
    }
    expect(status).toBe('complete');
  });

  it('loops audit → repair → audit without leaving the pipeline', () => {
    expect(transitionGeneration('auditing', 'repairing')).toEqual({ ok: true, value: 'repairing' });
    expect(transitionGeneration('repairing', 'auditing')).toEqual({ ok: true, value: 'auditing' });
  });

  it.each(GENERATION_STATUSES.filter(isTerminalGenerationStatus))(
    'refuses every transition out of the terminal status %s',
    (terminal) => {
      for (const next of GENERATION_STATUSES) {
        const result = transitionGeneration(terminal, next);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('terminal_state');
      }
    },
  );

  it('reaches partial only from repairing, synthesising_audio or publishing', () => {
    const sources = GENERATION_STATUSES.filter(
      (status) => transitionGeneration(status, 'partial').ok,
    );
    expect(sources.sort()).toEqual(['publishing', 'repairing', 'synthesising_audio']);
  });

  it('lets audio failure fall through to publishing so the curriculum survives', () => {
    expect(permittedGenerationTransitions('synthesising_audio')).toContain('publishing');
  });

  it('refuses to skip stages', () => {
    const result = transitionGeneration('queued', 'publishing');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_generation_transition');
  });

  it('allows cancellation from any non-terminal status', () => {
    for (const status of GENERATION_STATUSES.filter((s) => !isTerminalGenerationStatus(s))) {
      expect(transitionGeneration(status, 'cancelled').ok, `cancel from ${status}`).toBe(true);
    }
  });
});

describe('step idempotency', () => {
  const identity = {
    runId: 'run_1',
    step: 'generate_lesson' as const,
    subject: 'day-1',
    inputVersion: 'plan-v3',
  };

  it('derives a stable key from run, step, subject and input version', () => {
    expect(stepKey(identity)).toBe('run_1:generate_lesson:day-1:plan-v3');
    expect(stepKey(identity)).toBe(stepKey({ ...identity }));
  });

  it('separates concurrent instances of the same step', () => {
    expect(stepKey({ ...identity, subject: 'day-2' })).not.toBe(stepKey(identity));
  });

  it('changes the key when the inputs change, so a new version is generated', () => {
    expect(stepKey({ ...identity, inputVersion: 'plan-v4' })).not.toBe(stepKey(identity));
  });

  it('runs a step that has never been attempted', () => {
    expect(decideStep(undefined)).toEqual({ action: 'run', attempt: 1 });
  });

  it('reuses the recorded output instead of calling the provider again', () => {
    const record: StepRecord<{ lesson: string }> = {
      key: stepKey(identity),
      state: 'succeeded',
      attempt: 1,
      output: { lesson: 'day 1' },
    };
    expect(decideStep(record)).toEqual({ action: 'reuse', output: { lesson: 'day 1' } });
  });

  it('re-runs a step whose lease expired mid-flight', () => {
    const record: StepRecord<unknown> = { key: 'k', state: 'running', attempt: 1 };
    expect(decideStep(record)).toEqual({ action: 'run', attempt: 2 });
  });

  it('abandons a step that has exhausted its attempts, carrying the last error', () => {
    const record: StepRecord<unknown> = {
      key: 'k',
      state: 'failed',
      attempt: MAX_STEP_ATTEMPTS,
      error: 'provider 500',
    };
    const decision = decideStep(record);
    expect(decision.action).toBe('abandon');
    if (decision.action === 'abandon') expect(decision.reason).toContain('provider 500');
  });

  it('re-runs rather than reusing when a succeeded step recorded no output', () => {
    const record: StepRecord<unknown> = { key: 'k', state: 'succeeded', attempt: 1 };
    expect(decideStep(record)).toEqual({ action: 'run', attempt: 2 });
  });
});
