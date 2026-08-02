import { describe, expect, it } from 'vitest';
import {
  GAP_STATUSES,
  isTerminalGapStatus,
  permittedTransitions,
  transitionGap,
  type GapStatus,
  type GapTransition,
} from './state-machine.js';

const evidence = (required: string[], mastered: string[]) => ({
  requiredObjectiveIds: required,
  masteredObjectiveIds: mastered,
});

/** A representative transition value for each transition type, for matrix coverage. */
const sample: Record<GapTransition['type'], GapTransition> = {
  define: { type: 'define' },
  compile: { type: 'compile' },
  compilation_succeeded: { type: 'compilation_succeeded' },
  compilation_failed: { type: 'compilation_failed', reason: 'provider timeout' },
  retry_compilation: { type: 'retry_compilation' },
  request_mastery_check: { type: 'request_mastery_check' },
  mastery_confirmed: { type: 'mastery_confirmed', evidence: evidence(['o1'], ['o1']) },
  mastery_rejected: { type: 'mastery_rejected' },
  review_became_due: { type: 'review_became_due' },
  review_completed: { type: 'review_completed' },
  reopen: { type: 'reopen' },
  archive: { type: 'archive' },
};

describe('gap state machine', () => {
  describe('the happy path', () => {
    it('walks capture → compile → learn → prove → retain', () => {
      let status: GapStatus = 'draft';
      const path: GapTransition[] = [
        { type: 'define' },
        { type: 'compile' },
        { type: 'compilation_succeeded' },
        { type: 'request_mastery_check' },
        { type: 'mastery_confirmed', evidence: evidence(['o1', 'o2'], ['o1', 'o2']) },
      ];

      for (const transition of path) {
        const result = transitionGap(status, transition);
        expect(result.ok, `transition ${transition.type} from ${status}`).toBe(true);
        if (result.ok) status = result.value;
      }

      expect(status).toBe('filled');
    });

    it('returns a filled gap to review and back', () => {
      const due = transitionGap('filled', { type: 'review_became_due' });
      expect(due).toEqual({ ok: true, value: 'review_due' });
      expect(transitionGap('review_due', { type: 'review_completed' })).toEqual({
        ok: true,
        value: 'filled',
      });
    });
  });

  describe('the transition matrix', () => {
    it.each(GAP_STATUSES)('permits exactly the declared transitions from %s', (status) => {
      const permitted = permittedTransitions(status);

      for (const [type, transition] of Object.entries(sample) as [
        GapTransition['type'],
        GapTransition,
      ][]) {
        const result = transitionGap(status, transition);
        if (permitted.includes(type)) {
          expect(result.ok, `${status} --${type}--> should be permitted`).toBe(true);
        } else {
          expect(result.ok, `${status} --${type}--> should be refused`).toBe(false);
        }
      }
    });

    it('reaches every non-terminal status from draft', () => {
      // Guards against a status existing in the type but being unreachable in practice.
      const reachable = new Set<GapStatus>(['draft']);
      let changed = true;
      while (changed) {
        changed = false;
        for (const status of [...reachable]) {
          for (const transition of Object.values(sample)) {
            const result = transitionGap(status, transition);
            if (result.ok && !reachable.has(result.value)) {
              reachable.add(result.value);
              changed = true;
            }
          }
        }
      }
      expect([...reachable].sort()).toEqual([...GAP_STATUSES].sort());
    });
  });

  describe('refusals', () => {
    it('refuses an invalid transition with a typed error, not a throw', () => {
      const result = transitionGap('draft', { type: 'compile' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_gap_transition');
        expect(result.error.details).toMatchObject({ current: 'draft', attempted: 'compile' });
      }
    });

    it('refuses any transition out of an archived gap', () => {
      expect(isTerminalGapStatus('archived')).toBe(true);
      for (const transition of Object.values(sample)) {
        const result = transitionGap('archived', transition);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('terminal_state');
      }
    });

    it('never allows filled to be reached without a mastery check', () => {
      for (const status of GAP_STATUSES) {
        if (status === 'mastery_check' || status === 'review_due') continue;
        const result = transitionGap(status, sample.mastery_confirmed);
        expect(result.ok, `${status} must not jump straight to filled`).toBe(false);
      }
    });

    it('refuses to fill a gap whose required objectives are not all mastered', () => {
      const result = transitionGap('mastery_check', {
        type: 'mastery_confirmed',
        evidence: evidence(['o1', 'o2', 'o3'], ['o1', 'o3']),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('mastery_evidence_insufficient');
        expect(result.error.details.unmasteredObjectiveIds).toEqual(['o2']);
      }
    });

    it('refuses to fill a gap that has no required objectives at all', () => {
      // Consumption-only courses would otherwise trivially satisfy "all objectives mastered".
      const result = transitionGap('mastery_check', {
        type: 'mastery_confirmed',
        evidence: evidence([], []),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('mastery_evidence_insufficient');
    });

    it('sends a failed compilation to failed, which can be retried', () => {
      const failed = transitionGap('compiling', {
        type: 'compilation_failed',
        reason: 'provider timeout',
      });
      expect(failed).toEqual({ ok: true, value: 'failed' });
      expect(transitionGap('failed', { type: 'retry_compilation' })).toEqual({
        ok: true,
        value: 'compiling',
      });
    });
  });
});
