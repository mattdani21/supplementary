/**
 * Published-lesson content-quality comparison (E24 T052).
 *
 * The axis that matters for learning is the quality of what actually PUBLISHES, not
 * first-pass compliance. This script compiles the same reference fixture
 * (eval_01_set_operations) through the REAL pipeline in live mode — once per model via the
 * GAPOS_LLM_MODEL override — then scores every PUBLISHED lesson's script with the existing
 * human_sounding rubric (packages/domain/src/curriculum/script-structure.ts, the same four
 * detectors the evaluation scorer's `scoreHumanSounding` uses): concrete opening, one idea
 * per segment, worked example inside the script, checkpoint question. Repairs are fine:
 * published quality is what matters.
 *
 * Live (paid) run — human approval gate, AGENTS.md §5:
 *
 *   set -a; . ./.env; set +a; GAPOS_PROVIDER_MODE=live \
 *     pnpm tsx scripts/compare-lesson-quality.ts [--model deepseek-chat] [--model deepseek-v4-flash]
 *
 * Without --model it runs the default pair [deepseek-chat, deepseek-v4-flash] and prints a
 * comparison table. The rubric floor is SCORE_FLOORS.human_sounding = 0.75 (the share of
 * published lessons that must pass all four detectors, packages/evaluation/src/fixture.ts).
 * This script is a measurement, not a gate: a model that fails to compile or publishes
 * nothing is reported in the table as published 0 / floor FAIL (its reason is printed), and
 * the comparison still completes for the other models.
 */

import { checkStructuralElements, STRUCTURE_ELEMENT_LABELS } from '@gapos/domain';
import type { StructureElement } from '@gapos/domain';
import { fixtureById } from '@gapos/evaluation';
import {
  compileRaw,
  createEvalUser,
  createLiveEvalContext,
  createLiveEvalProviders,
  EVAL_OWNER,
} from '../tests/evaluation/live-helpers.js';

const FIXTURE_ID = 'eval_01_set_operations';
/** SCORE_FLOORS.human_sounding (packages/evaluation/src/fixture.ts): the share of published
 * lessons that must pass all four structural detectors. */
const HUMAN_SOUNDING_FLOOR = 0.75;
const DEFAULT_MODELS = ['deepseek-chat', 'deepseek-v4-flash'];
const ELEMENTS: readonly StructureElement[] = [
  'concrete_opening',
  'single_idea_per_segment',
  'worked_example',
  'checkpoint',
];

interface LessonQuality {
  readonly day: number;
  readonly title: string;
  readonly passed: number;
  readonly missing: readonly string[];
}

interface ModelResult {
  readonly model: string;
  readonly published: number;
  readonly passingAllFour: number;
  /** Share of published lessons passing all four detectors — the human_sounding dimension score. */
  readonly sharePassingAllFour: number;
  /** Mean share of the four detectors a published lesson passes (0..1). */
  readonly averageScore: number;
  readonly detectorHits: Readonly<Record<StructureElement, number>>;
  readonly floorPass: boolean;
  readonly lessons: readonly LessonQuality[];
  /** Set when the model failed to produce a curriculum — the published count is then 0. */
  readonly error?: string;
}

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const parseModels = (argv: readonly string[]): readonly string[] => {
  const models: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--model') {
      const model = argv[index + 1];
      if (model) models.push(model);
    }
  }
  return models.length > 0 ? models : DEFAULT_MODELS;
};

const emptyDetectorHits = (): Record<StructureElement, number> => ({
  concrete_opening: 0,
  single_idea_per_segment: 0,
  worked_example: 0,
  checkpoint: 0,
});

const runModel = async (model: string): Promise<ModelResult> => {
  // The live backend reads GAPOS_LLM_MODEL when the provider set is constructed, so setting
  // it here IS the GAPOS_LLM_MODEL override for this model's compile.
  process.env.GAPOS_LLM_MODEL = model;
  const context = createLiveEvalContext(createLiveEvalProviders());
  await createEvalUser(context);

  const fixture = fixtureById(FIXTURE_ID);
  if (!fixture) throw new Error(`Unknown fixture ${FIXTURE_ID}`);

  out(`\n=== model ${model} ===`);
  const outcome = await compileRaw(context, fixture, `compare_quality_${model}`);
  if (!outcome.curriculumId) {
    const reason = `no curriculum (status ${outcome.status}, error ${outcome.error ?? 'none'})`;
    out(`compile status: ${outcome.status} — ${reason}`);
    return {
      model,
      published: 0,
      passingAllFour: 0,
      sharePassingAllFour: 0,
      averageScore: 0,
      detectorHits: emptyDetectorHits(),
      floorPass: false,
      lessons: [],
      error: reason,
    };
  }

  const lessons = await context.uow.curricula.listLessons(EVAL_OWNER, outcome.curriculumId);
  const published = lessons.filter((lesson) => lesson.publicationStatus === 'published');
  out(
    `compile status: ${outcome.status} | lessons recorded: ${lessons.length} | PUBLISHED: ${published.length}`,
  );
  if (published.length === 0) {
    return {
      model,
      published: 0,
      passingAllFour: 0,
      sharePassingAllFour: 0,
      averageScore: 0,
      detectorHits: emptyDetectorHits(),
      floorPass: false,
      lessons: [],
      error: 'compiled but published no lessons',
    };
  }

  const detectorHits = emptyDetectorHits();
  const lessonQuality: LessonQuality[] = [];
  let passingAllFour = 0;
  let detectorsPassed = 0;

  for (const lesson of published) {
    const checks = checkStructuralElements({
      script: lesson.package.script,
      examples: lesson.package.examples,
      pausePrompts: lesson.package.pausePrompts,
    });
    const missing = checks
      .filter((check) => !check.passes)
      .map((check) => STRUCTURE_ELEMENT_LABELS[check.element]);
    for (const check of checks) {
      if (check.passes) detectorHits[check.element] += 1;
    }
    const passed = checks.filter((check) => check.passes).length;
    detectorsPassed += passed;
    if (passed === checks.length) passingAllFour += 1;
    lessonQuality.push({ day: lesson.day, title: lesson.title, passed, missing });
  }

  const sharePassingAllFour = passingAllFour / published.length;
  return {
    model,
    published: published.length,
    passingAllFour,
    sharePassingAllFour,
    averageScore: detectorsPassed / (published.length * ELEMENTS.length),
    detectorHits,
    floorPass: sharePassingAllFour >= HUMAN_SOUNDING_FLOOR,
    lessons: lessonQuality,
  };
};

const formatShare = (numerator: number, denominator: number): string =>
  denominator === 0
    ? 'n/a'
    : `${(numerator / denominator).toFixed(3)} (${numerator}/${denominator})`;

const printTable = (results: readonly ModelResult[]): void => {
  const header = [
    'model',
    'published',
    'pass-all-4',
    'share',
    'floor(>=0.75)',
    'avg score',
    'concrete opening',
    'one idea/segment',
    'worked example',
    'checkpoint',
  ];
  const widths = header.map((title, index) =>
    Math.max(
      title.length,
      ...results.map((result) => {
        switch (index) {
          case 0:
            return result.model.length;
          case 1:
            return String(result.published).length;
          case 2:
            return String(result.passingAllFour).length;
          case 3:
            return result.sharePassingAllFour.toFixed(3).length;
          case 4:
            return (result.floorPass ? 'PASS' : 'FAIL').length;
          case 5:
            return result.averageScore.toFixed(3).length;
          default: {
            const element = ELEMENTS[index - 6]!;
            return formatShare(result.detectorHits[element], result.published).length;
          }
        }
      }),
    ),
  );
  const row = (cells: readonly string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index]!)).join('  ');

  out('');
  out('Comparison table — eval_01_set_operations, PUBLISHED lessons, human_sounding rubric');
  out(
    '(concrete opening | one idea per segment | worked example | checkpoint; floor = share of lessons passing all four >= 0.75)',
  );
  out(row(header));
  for (const result of results) {
    out(
      row([
        result.model,
        String(result.published),
        String(result.passingAllFour),
        result.sharePassingAllFour.toFixed(3),
        result.floorPass ? 'PASS' : 'FAIL',
        result.averageScore.toFixed(3),
        formatShare(result.detectorHits.concrete_opening, result.published),
        formatShare(result.detectorHits.single_idea_per_segment, result.published),
        formatShare(result.detectorHits.worked_example, result.published),
        formatShare(result.detectorHits.checkpoint, result.published),
      ]),
    );
  }
  out('');
};

const main = async (): Promise<void> => {
  if (process.env.GAPOS_PROVIDER_MODE !== 'live') {
    console.error(
      'compare-lesson-quality is a live (paid) run: set GAPOS_PROVIDER_MODE=live and ' +
        'GAPOS_LLM_API_KEY (AGENTS.md §5 human approval gate).',
    );
    process.exit(2);
  }

  const models = parseModels(process.argv.slice(2));
  out(
    `Comparing published-lesson quality for fixture ${FIXTURE_ID} across ${models.join(', ')} ` +
      `(rubric floor ${HUMAN_SOUNDING_FLOOR}); live compiles, budget per run ` +
      `${process.env.GAPOS_BUDGET_PER_RUN_CENTS ?? 200}c.`,
  );

  const results: ModelResult[] = [];
  for (const model of models) {
    results.push(await runModel(model));
    const result = results[results.length - 1]!;
    if (result.error) {
      out(`  COMPILE FAILED — ${result.error}`);
      continue;
    }
    for (const lesson of result.lessons) {
      out(
        `  Day ${String(lesson.day).padStart(2)} [${lesson.passed}/4] ${lesson.title}` +
          (lesson.missing.length > 0 ? ` — missing: ${lesson.missing.join(', ')}` : ''),
      );
    }
  }

  printTable(results);
  out(
    'This script is a measurement, not a gate: floor PASS/FAIL reports the published-quality ' +
      'comparison per model (SCORE_FLOORS.human_sounding = 0.75). A model that fails to ' +
      'compile or publishes nothing is reported as published 0 / floor FAIL.',
  );
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
