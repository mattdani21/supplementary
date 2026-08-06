/**
 * The live-provider evaluation gate (GAP-014b).
 *
 * The deterministic fake returns the set-theory reference content for every request, so the
 * reference pack can only score eval_01. These tests compile the nine `requiresLiveProvider`
 * fixtures through the real pipeline against a real language model and real text-to-speech,
 * and assert the same pedagogical properties the fake gate asserts:
 *
 *   - every fixture produces a scorecard that clears every floor;
 *   - the underspecified fixture produces a clarification request, not a curriculum;
 *   - the injection fixture is reported as a finding and does not shape the curriculum;
 *   - no score regresses beyond tolerance against the stored baseline
 *     (tasks/evaluation-baselines.json, written by scripts/record-eval-baselines.ts).
 *
 * This is a paid run: it only executes when GAPOS_PROVIDER_MODE=live and GAPOS_LLM_API_KEY are
 * set, which is a human approval gate (AGENTS.md §5). When they are not, the block is skipped
 * loudly — a silently absent suite reads exactly like a passing one.
 */

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  EVALUATION_FIXTURES,
  compareToBaseline,
  fixtureById,
  formatScorecard,
  scoreCurriculum,
  type Baseline,
  type Scorecard,
} from '@gapos/evaluation';
import {
  compileFixture,
  compileRaw,
  createEvalUser,
  createLiveEvalContext,
  createLiveEvalProviders,
  EVAL_OWNER,
} from './live-helpers.js';
import type { ServerContext } from '../../apps/web/src/server/context.js';

const LIVE = process.env.GAPOS_PROVIDER_MODE === 'live';
const liveFixtures = EVALUATION_FIXTURES.filter((f) => f.requiresLiveProvider);
/** The underspecified fixture is verified separately: it must clarify, not produce a curriculum. */
const floorFixtures = liveFixtures.filter((f) => f.id !== 'eval_08_underspecified');

const loadBaselines = (): Record<string, Baseline> => {
  try {
    const parsed = JSON.parse(readFileSync('tasks/evaluation-baselines.json', 'utf8')) as {
      baselines: Record<string, Baseline>;
    };
    return parsed.baselines;
  } catch {
    return {};
  }
};

/** Compile a fixture inline so the run id is available for finding lookups. */
const compileRawFor = (context: ServerContext, fixtureId: string, idempotencyKey: string) =>
  compileRaw(context, fixtureById(fixtureId)!, idempotencyKey);

if (LIVE) {
  describe('the live-provider pack clears the gate (GAP-014b)', () => {
    const context = createLiveEvalContext(createLiveEvalProviders());
    const baselines = loadBaselines();
    let scorecards: Map<string, Scorecard>;

    beforeAll(async () => {
      await createEvalUser(context);
      scorecards = new Map();
      for (const fixture of floorFixtures) {
        const produced = await compileFixture(context, fixture.id);
        scorecards.set(fixture.id, scoreCurriculum(fixture, produced));
      }
      // Measured: a live fixture takes ~7.3 min (eval_05: 435s), so nine fixtures plus the
      // two standalone compiles need well over an hour; the live gate also spends time on
      // retry loops (a truncated plan burns four adapter attempts plus a corrective retry),
      // so 120 minutes is the evidence-based hook.
    }, 120 * 60_000);

    it('scores every fixture, not only eval_01', () => {
      expect(scorecards.size).toBe(floorFixtures.length);
      for (const fixture of floorFixtures) {
        expect(scorecards.has(fixture.id), `${fixture.id} has a scorecard`).toBe(true);
      }
    });

    it.each(floorFixtures.map((f) => [f.id, f.title] as const))(
      '%s clears every floor',
      (fixtureId) => {
        const scorecard = scorecards.get(fixtureId)!;
        expect(scorecard.passed, formatScorecard(scorecard)).toBe(true);
      },
    );

    it('does not regress beyond tolerance against the stored baseline', () => {
      for (const fixture of floorFixtures) {
        const scorecard = scorecards.get(fixture.id)!;
        const verdict = compareToBaseline(scorecard, baselines[fixture.id]);
        if (verdict.status === 'regressed') {
          const dimensions = verdict.dimensions
            .map((d) => `${d.dimension}: ${d.from} → ${d.to}`)
            .join(', ');
          expect(
            false,
            `${fixture.id} regressed by ${verdict.delta}: ${dimensions}. Run scripts/record-eval-baselines.ts only after an intentional change.`,
          ).toBe(true);
        }
      }
    });

    it(
      'the underspecified fixture asks for clarification rather than guessing',
      async () => {
        const outcome = await compileRawFor(context, 'eval_08_underspecified', 'eval_08_live');
        expect(outcome.error).toBe('clarification_required');
        expect(outcome.curriculumId).toBeUndefined();
      },
      // Standalone compiles are slower than floor fixtures when repairs engage (each call
      // carries the reasoning model's full chain of thought); 30 minutes is the hook.
      30 * 60_000,
    );

    it(
      'the injection fixture is reported as a finding and does not shape the curriculum',
      async () => {
        const outcome = await compileRawFor(context, 'eval_07_prompt_injection', 'eval_07_live');
        expect(outcome.error).toBeUndefined();
        expect(outcome.curriculumId).toBeDefined();

        const findings = await context.uow.generation.listFindings(EVAL_OWNER, outcome.runId);
        const injection = findings.filter((f) => f.category === 'prompt_injection');
        expect(injection.length).toBeGreaterThan(0);
        expect(injection[0]!.finding).toContain('treated as evidence and not followed');

        const curriculum = await context.uow.curricula.get(EVAL_OWNER, outcome.curriculumId!);
        const lessons = await context.uow.curricula.listLessons(EVAL_OWNER, outcome.curriculumId!);
        const scorecard = scoreCurriculum(fixtureById('eval_07_prompt_injection')!, {
          plan: curriculum!.plan,
          lessons: lessons.map((lesson) => lesson.package),
        });
        expect(scorecard.passed, formatScorecard(scorecard)).toBe(true);
      },
      // Standalone compiles are slower than floor fixtures when repairs engage (each call
      // carries the reasoning model's full chain of thought); 30 minutes is the hook.
      30 * 60_000,
    );
  });
} else {
  describe('live-provider pack (GAP-014b)', () => {
    it.skip('was not exercised: set GAPOS_PROVIDER_MODE=live and GAPOS_LLM_API_KEY to score the nine live fixtures', () => {
      expect.unreachable();
    });
  });
}
