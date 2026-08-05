/**
 * The compilation pipeline.
 *
 * Stages A–H from docs/ARCHITECTURE.md, orchestrated over idempotent steps. The shape of the
 * function is the shape of the latency budget: sources ingest concurrently, planning is
 * sequential because everything downstream depends on it, and each day then runs its own
 * generate → verify → repair → synthesise → publish pipeline with bounded concurrency so Day 1
 * can publish while later days are still working.
 *
 * Every failure mode here is a product behaviour rather than an exception:
 *   - a plan that violates the learner's constraints is sent back once with every violation, then
 *     fails the run rather than teaching something that does not fit;
 *   - an artefact that fails verification is repaired at most twice, then excluded if coverage
 *     survives without it, or the run goes `partial`;
 *   - audio that cannot be synthesised degrades to transcript, and the curriculum survives;
 *   - an exhausted budget stops the run instead of overspending.
 */

import { createHash } from 'node:crypto';
import {
  CurriculumPlanContract,
  DiagnosticInterpretationContract,
  GapNormalisationContract,
  LessonPackageContract,
  LessonScriptContract,
  VerificationReportContract,
  type CurriculumPlan,
  type DayPlan,
  type EvidenceItem,
  type LessonPackage,
  type LessonPackageContractOutput,
  type LessonScript,
} from '@gapos/ai-contracts';
import { detectInjectionAttempts, type Contract } from '@gapos/ai-contracts';
import type { ObjectStore, OwnerId, UnitOfWork } from '@gapos/database';
import { textOf } from '@gapos/database';
import {
  DomainError,
  GENERATION_STATUSES,
  blocksPublication,
  checkAudioIntegrity,
  chunkDocument,
  classifyPriorCapabilities,
  decideRepair,
  findAssessmentGaps,
  findPlanViolations,
  isTerminalGenerationStatus,
  segmentScript,
  transitionGeneration,
  verifyLesson,
  type Finding,
  type GenerationStatus,
  type PriorCapability,
} from '@gapos/domain';
import type { Logger, Metrics } from '@gapos/observability';
import { LiveProviderError, ProviderContractError, type Providers } from '@gapos/provider-adapters';
import { mapWithConcurrency, runStep, type StepContext } from './step-runner.js';

export const PIPELINE_VERSION = '1.0.0';

/** How many times the planner is asked again after a rejected or truncated plan. */
export const MAX_PLAN_ATTEMPTS = 3;
/** Contract retries per lesson package: the model occasionally drops a required field. */
export const MAX_LESSON_CONTRACT_ATTEMPTS = 3;
/**
 * The largest structured payloads (plans, lesson packages) get an explicit output budget:
 * provider defaults (~4096 tokens) truncate a long JSON mid-string, and truncation parses as
 * an unparseable-JSON failure that no repair loop can see.
 */
export const PLAN_MAX_OUTPUT_TOKENS = 8192;
export const LESSON_MAX_OUTPUT_TOKENS = 8192;

export interface CompileDeps {
  readonly uow: UnitOfWork;
  readonly storage: ObjectStore;
  readonly providers: Providers;
  readonly metrics: Metrics;
  readonly logger: Logger;
  readonly now: () => Date;
  readonly newId: (prefix: string) => string;
  /** Bounded fan-out. Seven simultaneous provider calls is how a rate limit fails a compile. */
  readonly concurrency?: number;
  /** Text-only mode. Audio also falls back to this automatically when synthesis fails. */
  readonly audioEnabled?: boolean;
  /**
   * Re-enter an existing run instead of deduplicating to it. The durable worker sets this: a
   * crash left the run in flight and its steps recorded, so re-entry resumes from where it
   * stopped (recorded steps are reused). The synchronous API path leaves it false, where a
   * repeated idempotency key must return the existing run without touching it.
   */
  readonly resumeExisting?: boolean;
}

export interface CompileRequest {
  readonly owner: OwnerId;
  readonly gapId: string;
  readonly idempotencyKey: string;
}

export interface DayOutcome {
  readonly day: number;
  readonly lessonId: string;
  readonly published: boolean;
  readonly excluded: boolean;
  readonly audioSegments: number;
  readonly textOnly: boolean;
  readonly repairAttempts: number;
  readonly findings: readonly Finding[];
  readonly publishedAt?: Date;
}

export interface CompileOutcome {
  readonly runId: string;
  readonly status: GenerationStatus;
  readonly curriculumId?: string;
  readonly days: readonly DayOutcome[];
  readonly dayOnePublishedAt?: Date;
  readonly completedAt?: Date;
  readonly error?: string;
  /** True when this call returned a run that a previous identical request had already started. */
  readonly deduplicated?: boolean;
}

const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const shortChecksum = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 32);

export const compileGap = async (
  request: CompileRequest,
  deps: CompileDeps,
): Promise<CompileOutcome> => {
  const { uow, providers, metrics, now, newId } = deps;
  const owner = request.owner;

  const gap = await uow.gaps.get(owner, request.gapId);
  if (!gap) {
    throw new DomainError('not_found', `Gap ${request.gapId} was not found for this owner.`, {
      gapId: request.gapId,
    });
  }

  const { run, created } = await uow.generation.startRun(owner, {
    id: newId('run'),
    gapId: gap.id,
    pipelineVersion: PIPELINE_VERSION,
    status: 'queued',
    idempotencyKey: request.idempotencyKey,
    startedAt: now(),
    costMillicents: 0,
  });

  const logger = deps.logger.child({ runId: run.id, gapId: gap.id });

  if (!created) {
    if (!deps.resumeExisting) {
      // The idempotency guarantee: a repeated compile returns the run already in flight rather
      // than starting a second one and charging twice for the same curriculum.
      logger.info('Compile already started for this idempotency key; returning the existing run');
      return {
        runId: run.id,
        status: run.status,
        days: await summariseExistingRun(owner, gap.id, deps),
        deduplicated: true,
      };
    }

    // The worker re-enters its own run after a crash. An in-flight run is resumed from its
    // recorded step state; a terminal one cannot be — report it as the failure it was, and the
    // job's next attempt uses a fresh key.
    if (isTerminalGenerationStatus(run.status)) {
      if (run.status === 'complete' || run.status === 'partial') {
        logger.info('Run already finished successfully; replaying its outcome', {
          status: run.status,
        });
        return {
          runId: run.id,
          status: run.status,
          days: await summariseExistingRun(owner, gap.id, deps),
          deduplicated: false,
        };
      }
      logger.warn('Run already ended; the attempt cannot resume it', { status: run.status });
      return {
        runId: run.id,
        status: 'failed',
        days: [],
        error: run.error ?? `The run already ended as ${run.status}.`,
        deduplicated: false,
      };
    }
    logger.info('Resuming an in-flight run after a worker restart', { status: run.status });
  }

  const step: StepContext = { owner, runId: run.id, generation: uow.generation, logger, metrics };
  const compileStarted = Date.now();

  let status: GenerationStatus = run.status;
  const stageOrder = new Map(GENERATION_STATUSES.map((stage, index) => [stage, index]));
  const advance = async (next: GenerationStatus): Promise<void> => {
    // Re-entry must not walk backwards: a run resumed from `publishing` is already past
    // `ingesting`, and the state machine would rightly refuse the backward transition.
    if (stageOrder.get(status)! >= stageOrder.get(next)!) return;
    const result = transitionGeneration(status, next);
    if (!result.ok) throw result.error;
    status = result.value;
    await uow.generation.setRunStatus(owner, run.id, status);
  };

  try {
    /* --------------------------------------------- stage B: ingest and ground sources */
    await advance('ingesting');
    await ingestSources({ owner, gapId: gap.id, step, deps });
    const evidence = await gatherEvidence(owner, gap.id, gap.rawStatement, step, deps);

    // Instruction-like text inside a source is reported, never followed (docs/SECURITY.md).
    //
    // Scanned over every ingested chunk rather than over the retrieved evidence. Retrieval
    // selects chunks by relevance to the learner's question, and a hostile paragraph is
    // typically about nothing — so scanning only what was retrieved silently misses the payload
    // on this run and lets it through on a later query that happens to match it.
    for (const signal of detectInjectionAttempts(await allChunks(owner, gap.id, deps))) {
      await uow.generation.addFinding(owner, {
        id: newId('finding'),
        runId: run.id,
        targetId: signal.chunkId,
        category: 'prompt_injection',
        severity: 'high',
        finding:
          `Source chunk ${signal.chunkId} contains instruction-like text, which was treated as ` +
          'evidence and not followed.',
        repairStatus: 'accepted',
        repairAttempts: 0,
      });
      metrics.increment('audit_finding_total', { category: 'prompt_injection' });
      // The chunk id, not the payload: the log must not become a copy of the hostile text.
      logger.warn('Instruction-like text found in a source; recorded as a finding', {
        chunkId: signal.chunkId,
      });
    }

    /* ----------------------------------------------------- stage A: normalise the gap */
    await advance('planning');
    const normalisation = await runStep(
      step,
      { step: 'normalise_gap', inputVersion: hash([gap.rawStatement, gap.dailyMinutes]) },
      async () =>
        (
          await providers.languageModel.generate({
            contract: GapNormalisationContract,
            purpose: 'planning',
            // Structured extraction must be deterministic: the run retries idempotently, and a
            // degenerate-but-valid normalisation would poison every downstream stage.
            temperature: 0,
            runId: run.id,
            userId: owner,
            instruction:
              `Normalise this learner statement into the contract: "${gap.rawStatement}". ` +
              'The success condition must be observable behaviour, never "understands X". ' +
              'Ambiguities default to recorded_assumption: note them as labelled assumptions ' +
              'and proceed. Blocking is exceptional — a blocking ambiguity stops the run and ' +
              'asks the learner a question — so use it only when the answer would make the ' +
              'curriculum materially different AND the learner cannot usefully start without ' +
              'it. A statement that names no target capability at all is blocking: for ' +
              'example "I want to get better at maths" or "teach me something useful" — the ' +
              'topic itself is missing, so the curriculum would be materially different ' +
              'depending on the answer. A statement that names a topic and a target ("I can ' +
              'define a relation but not why equivalence classes partition a set") is never ' +
              'blocking: record assumptions and proceed.',
            evidence,
          })
        ).value,
    );

    const blocking = normalisation.ambiguities.filter((a) => a.materiality === 'blocking');
    if (blocking.length > 0) {
      // Asking is cheaper than compiling the wrong course. Everything else is recorded as a
      // labelled assumption and the run continues.
      logger.info('Compilation paused for clarification', { questions: blocking.length });
      await uow.generation.setRunStatus(owner, run.id, 'failed', 'clarification_required');
      return {
        runId: run.id,
        status: 'failed',
        days: [],
        error: 'clarification_required',
      };
    }

    /* ----------------------------------- stage B: recall prior mastered capabilities */
    // A filled gap is a reusable capability: its objectives and target capability can satisfy
    // an external prerequisite in a new curriculum — while the evidence is still strong. Decayed
    // evidence must not be assumed; the learner has to re-demonstrate it, so the decayed list is
    // handed to the diagnostic as material it must not take for granted.
    const filledGaps = await uow.gaps.list(owner, { status: 'filled' });
    const priorCapabilities: PriorCapability[] = [];
    for (const filled of filledGaps) {
      const priorCurriculum = await uow.curricula.getCurrentForGap(owner, filled.id);
      for (const objective of priorCurriculum?.plan.objectives ?? []) {
        priorCapabilities.push({
          capabilityId: objective.capabilityStatement,
          masteredAt: filled.updatedAt,
        });
      }
      if (filled.targetCapability) {
        priorCapabilities.push({
          capabilityId: filled.targetCapability,
          masteredAt: filled.updatedAt,
        });
      }
    }
    const priorReuse = classifyPriorCapabilities(priorCapabilities, now());
    if (priorReuse.decayed.length > 0) {
      metrics.increment('prior_capability_decay_total', {
        count: String(priorReuse.decayed.length),
      });
      logger.info('Prior capabilities have decayed; the diagnostic must re-demonstrate them', {
        decayed: priorReuse.decayed.length,
      });
    }

    /* --------------------------------------------------------------- stage C: diagnose */
    const diagnostic = await runStep(
      step,
      { step: 'interpret_diagnostic', inputVersion: hash([normalisation, priorReuse.decayed]) },
      async () =>
        (
          await providers.languageModel.generate({
            contract: DiagnosticInterpretationContract,
            purpose: 'classification',
            temperature: 0,
            runId: run.id,
            userId: owner,
            instruction:
              'The learner skipped the diagnostic. Based on this normalisation — topic: ' +
              `${normalisation.topic}; current state: ${normalisation.currentState}; target ` +
              `capability: ${normalisation.targetCapability} — infer a conservative baseline, ` +
              'set inferred to true, and recommend a lower starting difficulty so Day 1 ' +
              'calibrates from the first attempts.' +
              (priorReuse.decayed.length > 0
                ? ` The learner previously demonstrated: ${priorReuse.decayed.join('; ')} — ` +
                  'treat that as decayed. Do not assume it is current; recommend a ' +
                  're-demonstration item so the evidence is re-established.'
                : ''),
          })
        ).value,
    );

    if (diagnostic.inferred) {
      await uow.gaps.update(owner, gap.id, {
        assumptions: [
          ...gap.assumptions,
          'Baseline inferred rather than diagnosed; Day 1 includes a calibration activity.',
        ],
      });
    }

    /* ---------------------------------------------------- stage D: plan and validate */
    const learnerBrief = [
      `The learner stated: "${gap.rawStatement}".`,
      `The learner has ${gap.dailyMinutes} minutes per day.`,
      `Normalisation — topic: ${normalisation.topic}. Current state: ${normalisation.currentState}. ` +
        `Target capability: ${normalisation.targetCapability}. Observable success condition: ` +
        normalisation.observableSuccessCondition,
      ...(normalisation.assumedPrerequisites.length > 0
        ? [
            `The learner is assumed to already hold: ${normalisation.assumedPrerequisites.join(', ')}.`,
          ]
        : []),
      ...(diagnostic.demonstratedCapabilities.length > 0
        ? [`The learner already demonstrates: ${diagnostic.demonstratedCapabilities.join(', ')}.`]
        : []),
      ...(priorReuse.satisfied.length > 0
        ? [
            `The learner has previously mastered and still holds: ${priorReuse.satisfied.join(
              ', ',
            )}.`,
          ]
        : []),
    ].join(' ');

    const plan = await runStep(
      step,
      {
        step: 'plan_curriculum',
        inputVersion: hash([normalisation, diagnostic, priorReuse.satisfied]),
      },
      async () =>
        planCurriculum({
          runId: run.id,
          owner,
          gapId: gap.id,
          learnerBrief,
          evidence,
          satisfiedExternalPrerequisites: [
            ...normalisation.assumedPrerequisites,
            ...diagnostic.demonstratedCapabilities,
            ...priorReuse.satisfied,
          ],
          deps,
          logger,
        }),
    );

    // The run's own curriculum, if it already exists (a resumed run re-enters it rather than
    // creating a second course for the same gap — that is what keeps lesson and artefact ids
    // stable across a restart). A fresh run creates one.
    const curriculum =
      (await uow.curricula.getForRun(owner, run.id)) ??
      (await uow.curricula.create(owner, {
        id: newId('cur'),
        gapId: gap.id,
        runId: run.id,
        version: 1,
        durationDays: plan.days.length,
        dailyMinutes: plan.dailyMinutes,
        status: 'draft',
        plan,
        createdAt: now(),
      }));

    /* -------------------- stages E–H: generate, verify, repair, synthesise, publish */
    await advance('generating_lessons');
    await advance('generating_assessment');
    await advance('auditing');

    // Day 1 runs to completion on its own before the rest fan out.
    //
    // The product promise is a usable Day 1 within three minutes while the remaining six days
    // are still compiling, so Day 1 must not queue behind or interleave with them. Running it
    // first costs a little total wall-clock and buys the guarantee outright — with bounded
    // concurrency the publication order of concurrent days is otherwise arbitrary.
    const [firstDay, ...laterDays] = plan.days;
    const dayOneOutcome = firstDay
      ? await compileDay({
          dayPlan: firstDay,
          plan,
          curriculumId: curriculum.id,
          evidence,
          step,
          runId: run.id,
          owner,
          deps,
        })
      : undefined;

    const laterOutcomes = await mapWithConcurrency(
      laterDays,
      deps.concurrency ?? 2,
      async (dayPlan) =>
        compileDay({
          dayPlan,
          plan,
          curriculumId: curriculum.id,
          evidence,
          step,
          runId: run.id,
          owner,
          deps,
        }),
    );

    const days = dayOneOutcome ? [dayOneOutcome, ...laterOutcomes] : laterOutcomes;

    const published = days.filter((d) => d.published);
    if (days.some((d) => d.excluded)) await advance('repairing');
    await advance('synthesising_audio');
    await advance('publishing');

    // What was actually published, checked against what the blueprint promised. An objective
    // published with fewer items than its blueprint entry can never satisfy the mastery rule,
    // so the learner would practise forever with nothing to point at. Better to say so.
    const publishedItems = await collectPublishedItems(owner, curriculum.id, published, deps);
    const assessmentGaps = findAssessmentGaps(plan, publishedItems);

    for (const gapFound of assessmentGaps) {
      await uow.generation.addFinding(owner, {
        id: newId('finding'),
        runId: run.id,
        targetId: String(gapFound.details.objectiveId ?? curriculum.id),
        category: 'objective_coverage',
        severity: 'critical',
        finding: gapFound.message,
        repairStatus: 'open',
        repairAttempts: 0,
      });
      metrics.increment('audit_finding_total', { category: 'objective_coverage' });
      logger.warn('Published assessment falls short of the blueprint', {
        objectiveId: gapFound.details.objectiveId,
      });
    }

    const coverageHolds = requiredObjectivesCovered(plan, published) && assessmentGaps.length === 0;
    const finalStatus: GenerationStatus =
      published.length === 0 || !coverageHolds ? 'partial' : 'complete';

    await advance(finalStatus);
    await uow.curricula.setStatus(
      owner,
      curriculum.id,
      finalStatus === 'complete' ? 'published' : 'partial',
    );

    metrics.observe('full_course_publication_latency_ms', Date.now() - compileStarted);
    logger.info('Compilation finished', {
      status: finalStatus,
      published: published.length,
      excluded: days.length - published.length,
    });

    const dayOne = days.find((d) => d.day === 1);
    return {
      runId: run.id,
      status: finalStatus,
      curriculumId: curriculum.id,
      days,
      ...(dayOne?.publishedAt ? { dayOnePublishedAt: dayOne.publishedAt } : {}),
      completedAt: now(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Compilation failed', { error: message });
    await uow.generation.setRunStatus(owner, run.id, 'failed', message);
    return { runId: run.id, status: 'failed', days: [], error: message };
  }
};

/* --------------------------------------------------------------------- stage B */

const ingestSources = async (params: {
  owner: OwnerId;
  gapId: string;
  step: StepContext;
  deps: CompileDeps;
}): Promise<void> => {
  const { owner, gapId, step, deps } = params;
  const sources = await deps.uow.sources.listForGap(owner, gapId);

  await mapWithConcurrency(sources, deps.concurrency ?? 3, async (source) => {
    if (source.processingStatus === 'rejected') return;

    await runStep(
      step,
      // Keyed by checksum, so identical bytes are never extracted or charged for twice.
      { step: 'ingest_source', subject: source.id, inputVersion: source.checksum },
      async () => {
        const existing = await deps.uow.sources.listChunks(owner, source.id);
        if (existing.length > 0) return { chunks: existing.length, cached: true };

        const object = await deps.storage.get(owner, source.storageKey);
        if (!object) {
          deps.metrics.increment('source_extraction_failure_total', { reason: 'missing_object' });
          await deps.uow.sources.setStatus(owner, source.id, 'failed', 'missing_object');
          return { chunks: 0, cached: false };
        }

        const chunks = chunkDocument(textOf(object));
        await deps.uow.sources.replaceChunks(
          owner,
          source.id,
          chunks.map((chunk) => ({
            id: `${source.id}_c${chunk.ordinal}`,
            sourceId: source.id,
            ordinal: chunk.ordinal,
            text: chunk.text,
            locator: chunk.locator,
            extractionConfidence: chunk.extractionConfidence,
            tokenEstimate: chunk.tokenEstimate,
          })),
        );
        await deps.uow.sources.setStatus(owner, source.id, 'indexed');
        return { chunks: chunks.length, cached: false };
      },
    );

    // Embed the source's chunks for vector retrieval (GAP-018). A deployment without an
    // embedding capability records no vectors and retrieval stays lexical; with one, the
    // vectors are stored per chunk and the query later ranks by cosine distance.
    const chunks = await deps.uow.sources.listChunks(owner, source.id);
    if (chunks.length > 0) {
      await runStep(
        step,
        { step: 'embed_chunk', subject: source.id, inputVersion: source.checksum },
        async () => {
          const result = await deps.providers.embeddings.embed({
            texts: chunks.map((chunk) => chunk.text),
            runId: step.runId,
            userId: owner,
          });
          if (result) {
            await deps.uow.sources.setChunkEmbeddings(
              owner,
              source.id,
              chunks.map((chunk, index) => ({
                chunkId: chunk.id,
                vector: result.vectors[index]!,
              })),
            );
          }
          return { embedded: result ? result.vectors.length : 0 };
        },
      );
    }
  });
};

/* --------------------------------------------------------------------- stage D */

const planCurriculum = async (params: {
  runId: string;
  owner: OwnerId;
  gapId: string;
  /** Rendered learner state: the statement plus the normalisation and diagnostic. */
  learnerBrief: string;
  evidence: readonly EvidenceItem[];
  satisfiedExternalPrerequisites: readonly string[];
  deps: CompileDeps;
  logger: Logger;
}): Promise<CurriculumPlan> => {
  const { runId, owner, gapId, evidence, deps, logger } = params;
  let previousViolations: string[] = [];

  for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await deps.providers.languageModel.generate({
        contract: CurriculumPlanContract,
        purpose: 'planning',
        temperature: 0,
        // Plans are the largest structured payload in the pipeline; the provider caps
        // structured output (~4096 tokens regardless of max_tokens), which truncated a long
        // plan mid-JSON and killed live compiles. Terseness is a free variable of the
        // contract, so retries demand it explicitly.
        maxOutputTokens: PLAN_MAX_OUTPUT_TOKENS,
        runId,
        userId: owner,
        subject: gapId,
        instruction:
          `${params.learnerBrief} Produce a curriculum plan that satisfies every invariant the ` +
          "product enforces: (1) every day's activities fit within the learner's daily minutes; " +
          '(2) every objective is taught on at least one day, and no day teaches an objective the ' +
          'plan does not declare; (3) the assessment blueprint has exactly one entry per objective, ' +
          'each with at least 2 retrieval and 1 application items, and no entry for an undeclared ' +
          'objective; (4) the prerequisite graph is acyclic, and every prerequisiteObjectiveId names ' +
          'an objective the plan teaches; (5) every source-grounded objective cites locators from ' +
          'the evidence; (6) externalPrerequisites must be copied verbatim from the list of what ' +
          'the learner is assumed to already hold — never invent a prerequisite outside it; teach ' +
          'it as an objective instead, or remove the dependency; (7) an audio lesson is a ' +
          'five-minute listening activity (~750 spoken words), scheduled alongside practice ' +
          'activities that together fit the daily budget; (8) targetDifficulty must not decrease ' +
          'across the course — later objectives are harder than earlier ones.' +
          (previousViolations.length > 0
            ? ` The previous plan was rejected for: ${previousViolations.join('; ')}. Fix all of them. ` +
              'Keep the plan terse — capabilityStatements under 25 words, one sentence per daily ' +
              'activity — and emit the JSON compactly (no line breaks), so the whole plan fits ' +
              'the output budget.'
            : ''),
        evidence,
      });
    } catch (error) {
      // A contract failure or a persistent transport failure (typically truncation: the
      // provider caps structured output at ~4096 tokens regardless of max_tokens) is
      // repairable like a violation — retry with the rejection quoted, an explicit terseness
      // demand, and compact JSON, so the plan fits the output budget.
      if (error instanceof ProviderContractError) {
        previousViolations = [...error.issues];
      } else if (error instanceof LiveProviderError && error.retryable) {
        previousViolations = [error.message];
      } else {
        throw error;
      }
    }

    if (response) {
      const violations = findPlanViolations(response.value, {
        satisfiedExternalPrerequisites: params.satisfiedExternalPrerequisites,
      });
      if (violations.length === 0) return response.value;
      previousViolations = violations.map((v) => v.message);
    }

    deps.metrics.increment('repair_attempt_total', { stage: 'planning' });
    logger.warn('Plan rejected; asking the planner to repair every violation at once', {
      attempt,
      violations: previousViolations.length,
    });
  }

  // Better to fail the compile than to teach a curriculum that does not fit the learner's time
  // or leaves an objective unassessed.
  throw new DomainError(
    'objective_not_assessed',
    `The planner could not produce a valid plan in ${MAX_PLAN_ATTEMPTS} attempts: ` +
      previousViolations.join('; '),
    { violations: previousViolations },
  );
};

/* ----------------------------------------------------------------- stages E–H */

interface CompileDayParams {
  readonly dayPlan: DayPlan;
  readonly plan: CurriculumPlan;
  readonly curriculumId: string;
  readonly evidence: readonly EvidenceItem[];
  readonly step: StepContext;
  readonly runId: string;
  readonly owner: OwnerId;
  readonly deps: CompileDeps;
}

const compileDay = async (params: CompileDayParams): Promise<DayOutcome> => {
  const { dayPlan, plan, curriculumId, evidence, step, runId, owner, deps } = params;
  const { uow, providers, metrics, now, newId } = deps;
  const lessonId = `${curriculumId}_day${dayPlan.day}`;
  const planVersion = hash(plan);

  /* ------------------------------------------- stage E: generate against the plan */
  const objectiveStatements = new Map(plan.objectives.map((o) => [o.id, o.capabilityStatement]));
  const blueprintForDay = plan.assessmentBlueprint
    .filter((b) => dayPlan.objectiveIds.includes(b.objectiveId))
    .map(
      (b) =>
        `objective ${b.objectiveId} (${objectiveStatements.get(b.objectiveId) ?? 'unknown'}): at ` +
        `least ${b.retrievalItems} retrieval and ${b.applicationItems} application questions, ` +
        `target difficulty ${b.targetDifficulty}`,
    )
    .join('; ');
  const glossaryBrief =
    plan.glossary.length > 0
      ? plan.glossary.map((g) => `${g.term}: ${g.definition}`).join('; ')
      : 'none';

  let lesson: LessonPackage;

  /**
   * Generate a structured artefact with contract retries. The model occasionally drops a field
   * the schema requires (the live gate caught a free-response question without a rubric) and
   * providers cap structured output, truncating long JSON; the plan step repairs violations by
   * quoting them back, and every structured artefact gets the same courtesy — otherwise one
   * bad field fails the whole run. Retries are deterministic (temperature 0).
   */
  const generateStructured = async (
    contract: Contract<unknown>,
    purpose: 'teaching',
    instruction: string,
    temperature: number,
  ): Promise<unknown> => {
    let previousIssues: readonly string[] = [];
    for (let attempt = 1; attempt <= MAX_LESSON_CONTRACT_ATTEMPTS; attempt += 1) {
      try {
        const response = await providers.languageModel.generate({
          contract,
          purpose,
          temperature: attempt === 1 ? temperature : 0,
          maxOutputTokens: LESSON_MAX_OUTPUT_TOKENS,
          runId,
          userId: owner,
          subject: `day-${dayPlan.day}`,
          instruction:
            instruction +
            (previousIssues.length > 0
              ? ` The previous response failed validation: ${previousIssues.join('; ')}. Fix all of them. ` +
                'Emit the JSON compactly (no line breaks) so it fits the output budget.'
              : ''),
          evidence,
        });
        return response.value;
      } catch (error) {
        // A contract rejection OR a persistent transport failure (unparseable JSON after the
        // adapter's own retries) is repairable: retry with the rejection quoted back and an
        // explicit compactness demand, so the artefact fits the provider's structured-output
        // cap. Anything else is a genuine provider outage — fail loudly.
        if (error instanceof ProviderContractError) {
          previousIssues = error.issues;
        } else if (error instanceof LiveProviderError && error.retryable) {
          previousIssues = [error.message];
        } else {
          throw error;
        }
        step.logger.warn('Artefact rejected by contract; asking the model to fix the violations', {
          contract: contract.name,
          attempt,
          issues: previousIssues.length,
        });
        metrics.increment('repair_attempt_total', { stage: 'lesson_contract' });
      }
    }
    throw new ProviderContractError(contract.name, contract.version, previousIssues);
  };

  /** The five-minute spoken rule the product ships: 750 words ≈ 5 minutes. */
  const minutesForScript = (script: string): number =>
    Math.min(60, Math.max(1, Math.ceil(script.trim().split(/\s+/).length / 150)));

  /**
   * Stage E′: the spoken prose first. Providers cap structured output (json_object mode
   * truncates around 4096 tokens regardless of max_tokens), and a 750-word script plus the
   * structured package routinely exceeded it — the live gate saw lesson JSON cut mid-string.
   * Prose is generated alone, then the compact structured package, then assembled.
   */
  const scriptBundle = (await runStep(
    step,
    { step: 'generate_script', subject: `day-${dayPlan.day}`, inputVersion: planVersion },
    async () =>
      (await generateStructured(
        LessonScriptContract,
        'teaching',
        `Write the spoken lesson for Day ${dayPlan.day} against the approved plan. The script ` +
          'must be written to be spoken aloud — roughly 750 words for five minutes, plain ' +
          'sentences, no bullet lists, no references to figures. Use the shared glossary ' +
          `terms: ${glossaryBrief}. Provide the script, its verbatim transcript, and a ` +
          'one-paragraph summary of what the learner can now do.',
        0.2,
      )) as LessonScript,
  )) as LessonScript;

  const lessonPackage = (await runStep(
    step,
    { step: 'generate_lesson', subject: `day-${dayPlan.day}`, inputVersion: planVersion },
    async () =>
      (await generateStructured(
        LessonPackageContract,
        'teaching',
        `Write the Day ${dayPlan.day} lesson package against the approved plan. The plan, ` +
          'the glossary and the objective identifiers are fixed inputs: use the shared terms ' +
          'for the concepts they name and do not reinterpret an objective. ' +
          `Shared glossary: ${glossaryBrief}. Assessment blueprint for this day's objectives: ` +
          `${blueprintForDay}. Ship at least those item counts across the lesson's questions ` +
          '(application items may be marked transfer). The spoken script is generated ' +
          'separately; estimatedMinutes will be recomputed from it, so give your best ' +
          "estimate of the listening time (about 5 minutes for 750 words), never the day's " +
          'total budget. Every question prompt must be unique within the lesson. Every claim ' +
          'drawn from the source evidence must cite a locator from the evidence. Only ' +
          'multiple-choice questions carry an options field, with at least three distinct ' +
          'options and the answer among them; every other question type omits options. ' +
          'Free-response questions MUST carry a rubric — a non-empty string — and every ' +
          'other question type omits the rubric field entirely. Never emit null for any ' +
          'field: omit optional fields instead.',
        0.2,
      )) as LessonPackageContractOutput,
  )) as LessonPackageContractOutput;

  lesson = {
    ...lessonPackage,
    script: scriptBundle.script,
    transcript: scriptBundle.transcript,
    summary: scriptBundle.summary,
    estimatedMinutes: minutesForScript(scriptBundle.script),
  };

  const verificationContext = {
    glossaryTerms: plan.glossary.map((g) => g.term),
    targetDifficulty: new Map(
      plan.assessmentBlueprint.map((b) => [b.objectiveId, b.targetDifficulty]),
    ),
    plannedObjectiveIds: dayPlan.objectiveIds,
  };

  // Another day teaching the same objectives means this one can be dropped without losing
  // coverage — that is the difference between `exclude` and `partial`.
  const coverageSurvivesWithout = plan.days.some(
    (other) =>
      other.day !== dayPlan.day &&
      dayPlan.objectiveIds.every((id) => other.objectiveIds.includes(id)),
  );

  let repairAttempts = 0;
  let findings: Finding[] = [];
  let excluded = false;

  /* ---------------------------------------------- stages F–G: verify and repair */
  for (;;) {
    const report = await runStep(
      step,
      {
        step: 'verify_artefact',
        subject: `${lessonId}:${repairAttempts}`,
        inputVersion: hash(lesson),
      },
      async () =>
        (
          await providers.languageModel.generate({
            contract: VerificationReportContract,
            purpose: 'verification',
            temperature: 0,
            runId,
            userId: owner,
            subject: `day-${dayPlan.day}`,
            instruction:
              'Solve every question in this lesson independently, without reference to the ' +
              'published answer key, then report whether your answer agrees with it. Produce ' +
              'solutions; do not critique the prose.',
          })
        ).value,
    );

    findings = verifyLesson(
      {
        id: lessonId,
        day: lesson.day,
        objectiveIds: lesson.objectiveIds,
        script: lesson.script,
        transcript: lesson.transcript,
        estimatedMinutes: lesson.estimatedMinutes,
        questions: lesson.questions,
      },
      { ...verificationContext, independentSolutions: report.independentSolutions },
    );

    for (const finding of findings) {
      await uow.generation.addFinding(owner, {
        id: newId('finding'),
        runId,
        targetId: finding.targetId,
        category: finding.category,
        severity: finding.severity,
        finding: finding.finding,
        repairStatus: 'open',
        repairAttempts,
      });
      metrics.increment('audit_finding_total', { category: finding.category });
    }

    if (!blocksPublication(findings)) break;

    const decision = decideRepair(findings, {
      attemptsSoFar: repairAttempts,
      coverageSurvivesWithout,
    });
    if (decision.action !== 'repair') {
      excluded = true;
      step.logger.warn('Artefact could not be repaired', {
        day: dayPlan.day,
        decision: decision.action,
      });
      break;
    }

    repairAttempts = decision.attempt;
    metrics.increment('repair_attempt_total', { stage: 'lesson' });
    lesson = await runStep(
      step,
      {
        step: 'repair_artefact',
        subject: `${lessonId}:${repairAttempts}`,
        inputVersion: hash([lesson, decision.findings]),
      },
      async () => {
        const findingsBrief = decision.findings
          .map((f) => `${f.category}: ${f.finding}`)
          .join(' | ');
        const repairedScript = (await generateStructured(
          LessonScriptContract,
          'teaching',
          'Repair only the failed items in the spoken lesson; leave everything else ' +
            'untouched. Findings to address: ' +
            findingsBrief,
          0,
        )) as LessonScript;
        const repairedPackage = (await generateStructured(
          LessonPackageContract,
          'teaching',
          'Repair only the failed items in this lesson; leave everything else untouched. ' +
            'Findings to address: ' +
            findingsBrief,
          0,
        )) as LessonPackageContractOutput;
        return {
          ...repairedPackage,
          script: repairedScript.script,
          transcript: repairedScript.transcript,
          summary: repairedScript.summary,
          estimatedMinutes: minutesForScript(repairedScript.script),
        };
      },
    );
    metrics.increment('repair_success_total', { stage: 'lesson' });
  }

  await uow.curricula.upsertLesson(owner, {
    id: lessonId,
    curriculumId,
    day: lesson.day,
    ordinal: 0,
    title: lesson.title,
    estimatedMinutes: lesson.estimatedMinutes,
    objectiveIds: lesson.objectiveIds,
    package: lesson,
    version: repairAttempts + 1,
    publicationStatus: excluded ? 'excluded' : 'verified',
  });

  await uow.curricula.upsertQuestions(
    owner,
    lesson.questions.map((question) => ({
      id: `${lessonId}_${question.id}`,
      lessonId,
      objectiveId: question.objectiveId,
      payload: question,
      version: repairAttempts + 1,
      verified: !excluded,
    })),
  );

  if (excluded) {
    return {
      day: dayPlan.day,
      lessonId,
      published: false,
      excluded: true,
      audioSegments: 0,
      textOnly: true,
      repairAttempts,
      findings,
    };
  }

  /* -------------------------------------------- stage H: synthesise and publish */
  let audioSegments = 0;
  let textOnly = deps.audioEnabled === false;

  if (!textOnly) {
    try {
      const segments = segmentScript(lesson.script, {
        pauseAtSeconds: lesson.pausePrompts.map((p) => p.atSecond),
      });

      const results = await runStep(
        step,
        { step: 'synthesise_audio', subject: lessonId, inputVersion: hash(lesson.script) },
        async () =>
          mapWithConcurrency(segments, deps.concurrency ?? 3, async (segment) => {
            const audio = await providers.textToSpeech.synthesise({
              text: segment.text,
              segmentId: segment.id,
              voice: 'default',
              locale: 'en',
              runId,
              userId: owner,
            });
            return {
              segmentId: segment.id,
              checksum: audio.checksum,
              durationSeconds: audio.durationSeconds,
              storageKey: `${lessonId}/${segment.id}`,
              mediaType: audio.mediaType,
              bytes: audio.audio,
            };
          }),
      );

      // Publication integrity: the audio must correspond to the transcript beside it.
      const failures = checkAudioIntegrity(segments, results, shortChecksum);
      if (failures.length > 0) {
        throw new Error(`Audio integrity check failed: ${failures.map((f) => f.code).join(', ')}`);
      }

      for (const [index, result] of results.entries()) {
        await deps.storage.put(
          owner,
          result.storageKey,
          Uint8Array.from(result.bytes ?? []),
          result.mediaType,
        );
        await uow.curricula.addArtefact(owner, {
          // Deterministic: a resumed run re-enters the same artefacts instead of duplicating them.
          id: artefactId(lessonId, 'audio', index, repairAttempts + 1),
          lessonId,
          kind: 'audio',
          storageKey: result.storageKey,
          mediaType: result.mediaType,
          checksum: result.checksum,
          durationSeconds: result.durationSeconds,
          version: repairAttempts + 1,
          segmentOrdinal: index,
          frozen: false,
        });
      }
      audioSegments = results.length;
    } catch (error) {
      // The curriculum survives an audio failure: the learner reads instead of listening.
      metrics.increment('audio_generation_failure_total', { day: dayPlan.day });
      step.logger.warn('Audio synthesis failed; falling back to transcript only', {
        day: dayPlan.day,
        error: error instanceof Error ? error.message : String(error),
      });
      textOnly = true;
    }
  }

  await uow.curricula.addArtefact(owner, {
    id: artefactId(lessonId, 'transcript', 0, repairAttempts + 1),
    lessonId,
    kind: 'transcript',
    storageKey: `${lessonId}/transcript`,
    mediaType: 'text/plain',
    checksum: shortChecksum(lesson.transcript),
    version: repairAttempts + 1,
    segmentOrdinal: 0,
    frozen: false,
  });

  const publishedAt = now();
  await uow.curricula.publishLesson(owner, lessonId, publishedAt);

  return {
    day: dayPlan.day,
    lessonId,
    published: true,
    excluded: false,
    audioSegments,
    textOnly,
    repairAttempts,
    findings,
    publishedAt,
  };
};

/* ------------------------------------------------------------------------- helpers */

const requiredObjectivesCovered = (
  plan: CurriculumPlan,
  publishedDays: readonly DayOutcome[],
): boolean => {
  const publishedDayNumbers = new Set(publishedDays.map((d) => d.day));
  const covered = new Set(
    plan.days.filter((d) => publishedDayNumbers.has(d.day)).flatMap((d) => d.objectiveIds),
  );
  return plan.objectives.filter((o) => o.required).every((o) => covered.has(o.id));
};

/**
 * The stable identity of an artefact within a lesson. Keyed by (lesson, kind, segment, version)
 * rather than a random id so a resumed run re-enters the same rows: `addArtefact` is idempotent
 * on this id, which is what prevents duplicate audio after a worker restart.
 */
const artefactId = (
  lessonId: string,
  kind: 'audio' | 'transcript',
  segmentOrdinal: number,
  version: number,
): string => `${lessonId}:${kind}:${segmentOrdinal}:v${version}`;

/** The published items, as the blueprint conformance check needs to see them. */
const collectPublishedItems = async (
  owner: OwnerId,
  curriculumId: string,
  publishedDays: readonly DayOutcome[],
  deps: CompileDeps,
): Promise<{ objectiveId: string; role: 'retrieval' | 'application' | 'transfer' }[]> => {
  void curriculumId;
  const items: { objectiveId: string; role: 'retrieval' | 'application' | 'transfer' }[] = [];
  for (const day of publishedDays) {
    for (const question of await deps.uow.curricula.listQuestions(owner, day.lessonId)) {
      items.push({ objectiveId: question.objectiveId, role: question.payload.role });
    }
  }
  return items;
};

/** Every ingested chunk for a gap, across all its sources. Used by the injection scan. */
const allChunks = async (
  owner: OwnerId,
  gapId: string,
  deps: CompileDeps,
): Promise<EvidenceItem[]> => {
  const sources = await deps.uow.sources.listForGap(owner, gapId);
  const items: EvidenceItem[] = [];
  for (const source of sources) {
    for (const chunk of await deps.uow.sources.listChunks(owner, source.id)) {
      items.push({
        sourceId: chunk.sourceId,
        chunkId: chunk.id,
        locator: chunk.locator,
        text: chunk.text,
      });
    }
  }
  return items;
};

const gatherEvidence = async (
  owner: OwnerId,
  gapId: string,
  query: string,
  step: StepContext,
  deps: CompileDeps,
): Promise<EvidenceItem[]> => {
  // Embed the query once per run (GAP-018); the step records the vector so a resumed run
  // reuses it instead of re-charging. A deployment without embeddings records { embedded:
  // false } and retrieval stays lexical.
  const embedding = await runStep(
    step,
    { step: 'embed_query', inputVersion: hash(query) },
    async () => {
      const result = await deps.providers.embeddings.embed({
        texts: [query],
        runId: step.runId,
        userId: owner,
      });
      return result ? { vector: result.vectors[0]! } : { embedded: false as const };
    },
  );
  const vector = embedding.embedded === false ? undefined : embedding.vector;

  const chunks = await deps.uow.sources.searchChunks(owner, gapId, query, 12, vector);
  return chunks.map((chunk) => ({
    sourceId: chunk.sourceId,
    chunkId: chunk.id,
    locator: chunk.locator,
    text: chunk.text,
  }));
};

const summariseExistingRun = async (
  owner: OwnerId,
  gapId: string,
  deps: CompileDeps,
): Promise<DayOutcome[]> => {
  const curriculum = await deps.uow.curricula.getCurrentForGap(owner, gapId);
  if (!curriculum) return [];
  const lessons = await deps.uow.curricula.listLessons(owner, curriculum.id);
  return lessons.map((lesson) => ({
    day: lesson.day,
    lessonId: lesson.id,
    published: lesson.publicationStatus === 'published',
    excluded: lesson.publicationStatus === 'excluded',
    audioSegments: 0,
    textOnly: false,
    repairAttempts: lesson.version - 1,
    findings: [],
    ...(lesson.publishedAt ? { publishedAt: lesson.publishedAt } : {}),
  }));
};
