/**
 * Generation run status gate (GAP-091): the raw compile-progress surface only renders
 * while the pipeline is actively running. Terminal states (complete / partial / failed /
 * cancelled) show the calm course-progress card instead — the compile steps serve no
 * purpose on Today or a finished workspace then.
 */

import { describe, expect, it } from 'vitest';
import { isActiveRunStatus } from './generation-progress';

describe('isActiveRunStatus (GAP-091)', () => {
  it('is true for every in-flight pipeline status', () => {
    for (const status of [
      'queued',
      'ingesting',
      'planning',
      'generating_lessons',
      'generating_assessment',
      'auditing',
      'repairing',
      'synthesising_audio',
      'publishing',
    ]) {
      expect(isActiveRunStatus(status), status).toBe(true);
    }
  });

  it('is false for every terminal status — the compile card hides once the run settles', () => {
    for (const status of ['complete', 'partial', 'failed', 'cancelled']) {
      expect(isActiveRunStatus(status), status).toBe(false);
    }
  });

  it('is false when there is no run at all', () => {
    expect(isActiveRunStatus(undefined)).toBe(false);
    expect(isActiveRunStatus(null)).toBe(false);
  });
});
