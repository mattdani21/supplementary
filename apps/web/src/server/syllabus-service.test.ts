import { describe, expect, it } from 'vitest';
import { MACHINE_LEARNING_SYLLABUS_ID, machineLearningPlacementItems } from '@gapos/domain';
import { createServerContext } from './context.js';
import {
  enrollInSyllabus,
  getEnrollmentView,
  importSyllabusOutline,
  issuePlacementKit,
  listCatalog,
  PlacementResitBlockedError,
  requestResit,
  submitPlacement,
} from './services/syllabus-service.js';
import type { OwnerId } from '@gapos/database';

const owner = 'learner-syllabus' as OwnerId;

describe('syllabus placement loop', () => {
  it('lists the Machine Learning catalog syllabus', () => {
    const { syllabi } = listCatalog();
    expect(syllabi.some((s) => s.id === MACHINE_LEARNING_SYLLABUS_ID)).toBe(true);
  });

  it('places, spawns unmet courses idempotently, and blocks re-sit until filled', async () => {
    const context = createServerContext();
    const { enrollment } = await enrollInSyllabus(context, owner, MACHINE_LEARNING_SYLLABUS_ID);
    const { placement: kit } = await issuePlacementKit(context, owner, enrollment.id);

    expect(kit.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(kit)).not.toMatch(/"answer"/);

    const authored = machineLearningPlacementItems();
    const wrongAnswers = kit.items.map((item) => ({
      itemId: item.id,
      response: 'not the answer',
    }));

    const first = await submitPlacement(context, owner, enrollment.id, {
      kitId: kit.kitId,
      answers: wrongAnswers,
    });
    expect(first.placement.unmetObjectiveIds.length).toBe(authored.length);
    expect(first.placement.spawnedGaps.length).toBe(authored.length);
    const gapIds = first.placement.spawnedGaps.map((g) => g.gapId).sort();

    // Re-issue kit while remediations are open must fail.
    await expect(issuePlacementKit(context, owner, enrollment.id)).rejects.toBeInstanceOf(
      PlacementResitBlockedError,
    );
    await expect(requestResit(context, owner, enrollment.id)).rejects.toBeInstanceOf(
      PlacementResitBlockedError,
    );

    // Force-fill every spawned gap so re-sit unlocks (domain mastery is tested elsewhere;
    // here we prove the re-sit gate reads gap status).
    for (const spawned of first.placement.spawnedGaps) {
      const gap = await context.uow.gaps.get(owner, spawned.gapId);
      expect(gap).toBeDefined();
      await context.uow.gaps.setStatus(owner, spawned.gapId, 'ready', 'draft');
      await context.uow.gaps.setStatus(owner, spawned.gapId, 'compiling', 'ready');
      await context.uow.gaps.setStatus(owner, spawned.gapId, 'active', 'compiling');
      await context.uow.gaps.setStatus(owner, spawned.gapId, 'mastery_check', 'active');
      await context.uow.gaps.setStatus(owner, spawned.gapId, 'filled', 'mastery_check');
    }

    // Note: setStatus to filled requires mastery_check — but the repository setStatus does not
    // run the domain machine. The service re-sit gate only checks stored status === 'filled'.
    // Re-do properly: repository allows any status write with expected previous.
    // We already wrote filled from mastery_check above.

    const { placement: resitKit } = await requestResit(context, owner, enrollment.id);
    expect(resitKit.items.length).toBe(authored.length);

    const correct = resitKit.items.map((item) => {
      const key = authored.find((a) => a.id === item.id || a.objectiveId === item.objectiveId);
      return { itemId: item.id, response: key!.answer };
    });
    const second = await submitPlacement(context, owner, enrollment.id, {
      kitId: resitKit.kitId,
      answers: correct,
    });
    expect(second.placement.placedObjectiveIds.length).toBe(authored.length);
    expect(second.placement.unmetObjectiveIds).toEqual([]);
    // Idempotent: previously spawned gaps are reused, no new creates for already-placed path
    // (spawn plan empty when all placed).
    expect(second.placement.spawnedGaps).toEqual([]);

    const view = await getEnrollmentView(context, owner, enrollment.id);
    expect(view.enrollment.unlockedModuleIds.length).toBeGreaterThan(0);
    expect(view.enrollment.remediations.map((r) => r.gapId).sort()).toEqual(gapIds);
  });

  it('imports a structured outline into the same Syllabus shape and runs placement', async () => {
    const context = createServerContext();
    const { syllabus } = await importSyllabusOutline(context, owner, {
      title: 'Discrete Maths',
      description: 'Short university outline',
      modules: [
        { title: 'Sets', outcomes: ['Define a set and its elements'] },
        { title: 'Relations', outcomes: ['Decide whether a relation is reflexive'] },
      ],
    });
    expect(syllabus.source).toBe('imported');
    expect(syllabus.objectives).toHaveLength(2);

    const { enrollment } = await enrollInSyllabus(context, owner, syllabus.id);
    const { placement: kit } = await issuePlacementKit(context, owner, enrollment.id);
    // Answer every item correctly using the option that matches the objective statement.
    const answers = kit.items.map((item) => {
      const objective = syllabus.objectives.find((o) => o.id === item.objectiveId)!;
      return { itemId: item.id, response: objective.statement };
    });
    const result = await submitPlacement(context, owner, enrollment.id, {
      kitId: kit.kitId,
      answers,
    });
    expect(result.placement.unmetObjectiveIds).toEqual([]);
    expect(result.placement.unlockedModuleIds.length).toBe(2);
  });

  it('refuses a second spawn creating duplicate gaps for the same unmet objective', async () => {
    const context = createServerContext();
    const { enrollment } = await enrollInSyllabus(context, owner, MACHINE_LEARNING_SYLLABUS_ID);
    const { placement: kit } = await issuePlacementKit(context, owner, enrollment.id);
    const wrong = kit.items.map((item) => ({ itemId: item.id, response: 'nope' }));
    const first = await submitPlacement(context, owner, enrollment.id, {
      kitId: kit.kitId,
      answers: wrong,
    });

    // Simulate a second submit against a fresh kit after filling remediations, answering wrong again —
    // mergeSpawnIdempotently must reuse keys.
    for (const spawned of first.placement.spawnedGaps) {
      await context.uow.gaps.setStatus(owner, spawned.gapId, 'ready', 'draft');
      await context.uow.gaps.setStatus(owner, spawned.gapId, 'compiling', 'ready');
      await context.uow.gaps.setStatus(owner, spawned.gapId, 'active', 'compiling');
      await context.uow.gaps.setStatus(owner, spawned.gapId, 'mastery_check', 'active');
      await context.uow.gaps.setStatus(owner, spawned.gapId, 'filled', 'mastery_check');
    }
    const { placement: kit2 } = await issuePlacementKit(context, owner, enrollment.id);
    const second = await submitPlacement(context, owner, enrollment.id, {
      kitId: kit2.kitId,
      answers: kit2.items.map((item) => ({ itemId: item.id, response: 'still wrong' })),
    });
    expect(second.placement.spawnedGaps.every((g) => g.created === false)).toBe(true);
    expect(second.placement.spawnedGaps.map((g) => g.gapId).sort()).toEqual(
      first.placement.spawnedGaps.map((g) => g.gapId).sort(),
    );
  });
});
