/**
 * Traceability invariants (US2, E24 — FR-008/FR-009, SC-003/SC-006).
 *
 * Sources are the spine: every objective, every published lesson and every published practice
 * question must declare what it rests on, a source-grounded item must cite at least one locator,
 * and every cited locator must resolve to a real evidence chunk. `general_knowledge` is
 * permitted only when explicitly labelled.
 *
 * Pure: values in, violations out. The pipeline, the invariant tests and the evaluation gate all
 * consume the same helper.
 */

import type { CurriculumPlan, LessonPackage } from '@gapos/ai-contracts';
import type { EvidenceItem } from '@gapos/ai-contracts';

export interface TraceableItem {
  readonly id: string;
  readonly kind: 'objective' | 'lesson' | 'question';
  readonly evidence: {
    readonly basis: 'source' | 'general_knowledge';
    readonly locators: readonly { sourceId: string; chunkId: string }[];
  };
}

/**
 * Return every traceability violation in the produced curriculum, or an empty array when 100% of
 * items trace to a real locator or carry an explicit general-knowledge label.
 */
export const assertTraceability = (
  plan: CurriculumPlan,
  lessons: readonly LessonPackage[],
  evidence: readonly EvidenceItem[],
): readonly string[] => {
  const chunks = new Set(evidence.map((item) => `${item.sourceId}::${item.chunkId}`));
  const violations: string[] = [];

  const check = (item: TraceableItem): void => {
    if (item.evidence.basis === 'general_knowledge') return;

    if (item.evidence.locators.length === 0) {
      violations.push(
        `${item.kind} ${item.id} claims source grounding but cites no locator.`,
      );
      return;
    }

    for (const locator of item.evidence.locators) {
      if (!chunks.has(`${locator.sourceId}::${locator.chunkId}`)) {
        violations.push(
          `${item.kind} ${item.id} cites ${locator.sourceId}/${locator.chunkId}, which does ` +
            'not resolve to a supplied evidence chunk.',
        );
      }
    }
  };

  for (const objective of plan.objectives) {
    check({
      id: objective.id,
      kind: 'objective',
      evidence: objective.evidence,
    });
  }

  for (const lesson of lessons) {
    check({ id: `day-${lesson.day}`, kind: 'lesson', evidence: lesson.evidence });
    for (const question of lesson.questions) {
      check({ id: question.id, kind: 'question', evidence: question.evidence });
    }
  }

  return violations;
};
