import { describe, expect, it } from 'vitest';
import type { PlacementResult } from './placement.js';
import {
  canResitPlacement,
  mergeSpawnIdempotently,
  planRemediationSpawns,
  remediationIdempotencyKey,
} from './spawn.js';
import type { Syllabus } from './syllabus.js';

const syllabus = (): Syllabus => ({
  id: 'catalog:machine-learning',
  version: 1,
  title: 'Machine Learning',
  description: 'Core ML',
  source: 'catalog',
  modules: [{ id: 'mod-a', title: 'A', order: 1, objectiveIds: ['obj-a', 'obj-b', 'obj-opt'] }],
  objectives: [
    {
      id: 'obj-a',
      statement: 'Vectors',
      required: true,
      prerequisiteObjectiveIds: [],
    },
    {
      id: 'obj-b',
      statement: 'Loss',
      required: true,
      prerequisiteObjectiveIds: ['obj-a'],
    },
    {
      id: 'obj-opt',
      statement: 'Optional deep dive',
      required: false,
      prerequisiteObjectiveIds: [],
    },
  ],
});

const placement = (unmet: string[]): PlacementResult => ({
  placedObjectiveIds: [],
  unmetObjectiveIds: unmet,
  objectiveResults: unmet.map((objectiveId) => ({
    objectiveId,
    status: 'unmet',
    score: 0,
    itemCount: 1,
  })),
  unlockedModuleIds: [],
});

describe('planRemediationSpawns', () => {
  it('spawns only required unmet objectives with stable idempotency keys', () => {
    const plan = planRemediationSpawns('learner-1', syllabus(), placement(['obj-b', 'obj-opt']));
    expect(plan.gaps).toHaveLength(1);
    expect(plan.gaps[0]?.objectiveId).toBe('obj-b');
    expect(plan.gaps[0]?.idempotencyKey).toBe(
      remediationIdempotencyKey('learner-1', 'catalog:machine-learning', 1, 'obj-b'),
    );
  });

  it('reuses existing gaps on retry instead of duplicating', () => {
    const plan = planRemediationSpawns('learner-1', syllabus(), placement(['obj-a', 'obj-b']));
    const existing = [
      {
        objectiveId: 'obj-a',
        gapId: 'gap_existing',
        gapStatus: 'active' as const,
        idempotencyKey: plan.gaps[0]!.idempotencyKey,
      },
    ];
    const merged = mergeSpawnIdempotently(plan, existing);
    expect(merged.reused).toHaveLength(1);
    expect(merged.reused[0]?.gapId).toBe('gap_existing');
    expect(merged.toCreate).toHaveLength(1);
    expect(merged.toCreate[0]?.objectiveId).toBe('obj-b');
  });
});

describe('canResitPlacement', () => {
  it('blocks re-sit while any spawned gap is not filled', () => {
    const result = canResitPlacement([
      {
        objectiveId: 'obj-a',
        gapId: 'gap_1',
        gapStatus: 'active',
        idempotencyKey: 'k1',
      },
      {
        objectiveId: 'obj-b',
        gapId: 'gap_2',
        gapStatus: 'filled',
        idempotencyKey: 'k2',
      },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('placement_resit_blocked');
    expect(result.error.details.unfinishedGapIds).toEqual(['gap_1']);
  });

  it('allows re-sit when every remediation is filled', () => {
    const result = canResitPlacement([
      {
        objectiveId: 'obj-a',
        gapId: 'gap_1',
        gapStatus: 'filled',
        idempotencyKey: 'k1',
      },
    ]);
    expect(result.ok).toBe(true);
  });

  it('allows re-sit when there were no remediations', () => {
    expect(canResitPlacement([]).ok).toBe(true);
  });
});
