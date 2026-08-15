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
  ClaimAuditContract,
  CurriculumPlanContract,
  DiagnosticInterpretationContract,
  GapNormalisationContract,
  LessonPackageContract,
  VerificationReportContract,
  type CurriculumPlan,
  type DayPlan,
  type EvidenceItem,
  type LessonPackage,
} from '@gapos/ai-contracts';
import { detectInjectionAttempts } from '@gapos/ai-contracts';
import type { ObjectStore, OwnerId, UnitOfWork } from '@gapos/database';
import { textOf } from '@gapos/database';
import {
  DomainError,
  GENERATION_STATUSES,
  MASTERY_THRESHOLD,
  blocksPublication,
  checkAudioIntegrity,
  chunkDocument,
  classifyPriorCapabilities,
  decideRepair,
  derivePlanInputs,
  findAssessmentGaps,
  findPlanViolations,
  isTerminalGenerationStatus,
  personalisePlan,
  segmentScript,
  transitionGeneration,
  verifyLesson,
  type Finding,
  type GenerationStatus,
  type LearnerProfileInput,
  type MasteryInput,
  type PriorCapability,
} from '@gapos/domain';
import type { Logger, Metrics } from '@gapos/observability';
import { ProviderContractError, type Providers } from '@gapos/provider-adapters';
import { mapWithConcurrency, runStep, type StepContext } from './step-runner.js';

export const PIPELINE_VERSION = '1.1.0';

/** How many times the planner is asked again after a rejected plan. */
export const MAX_PLAN_ATTEMPTS = 2;
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

/**
 * What the `synthesise_audio` step records in the generation step log: a small summary instead of
 * the audio payload itself. The bytes live in object storage — the artefacts table holds each
 * segment's storage key and checksum — so persisting them a second time in
 * `generation_steps.output` is what turned a 7-day curriculum into 100+ MB of JSONB per step row.
 *
 * `checksum` and `storageKey` are index-aligned per segment (segment i's checksum belongs to
 * segment i's storage key), and match the artefacts table rows for the same lesson, so the log
 * can verify exactly what object storage holds.
 */
export interface AudioSynthesisStepOutput {
  readonly checksum: readonly string[];
  /** Total byte size of the synthesised audio across all segments. */
  readonly bytes: number;
  /** Number of audio segments this step produced. */
  readonly segments: number;
  readonly storageKey: readonly string[];
}

const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const shortChecksum = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 32);

/**
 * The slice of an evidence record the review-due rule reads. Kept minimal so the rule never
 * depends on the persistence record's full shape.
 */
export interface ReviewDueEvidence {
  readonly objectiveId: string;
  readonly recordedAt: Date;
  readonly score: number;
}

/**
 * FR-020: which previously demonstrated capabilities are due for review inside the new
 * curriculum, derived from the learner's evidence records (never a hardcoded empty list).
 *
 * A capability is due when its objective's MOST RECENT evidence record scores below the mastery
 * threshold — the learner recently answered weakly on it, so the new curriculum must schedule a
 * review even when the capability still counts as held from fill time. Objectives with no
 * evidence are never called in for review, and a capability is reported once across all prior
 * curricula. The result follows the prior curricula's plan-objective order, so identical inputs
 * always produce the identical brief (idempotency).
 */
export const reviewDueFromPriorCurricula = (params: {
  readonly curricula: readonly {
    readonly objectives: readonly { readonly id: string; readonly capabilityStatement: string }[];
    readonly evidence: readonly ReviewDueEvidence[];
  }[];
}): readonly string[] => {
  const due: string[] = [];
  const seen = new Set<string>();
  for (const curriculum of params.curricula) {
    const latestByObjective = new Map<string, ReviewDueEvidence>();
    for (const record of curriculum.evidence) {
      const current = latestByObjective.get(record.objectiveId);
      if (!current || record.recordedAt.getTime() >= current.recordedAt.getTime()) {
        latestByObjective.set(record.objectiveId, record);
      }
    }
    for (const objective of curriculum.objectives) {
      const record = latestByObjective.get(objective.id);
      if (!record || record.score >= MASTERY_THRESHOLD || seen.has(objective.capabilityStatement)) {
        continue;
      }
      seen.add(objective.capabilityStatement);
      due.push(objective.capabilityStatement);
    }
  }
  return due;
};

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
    //
    // The signals also flow into the verifier (E24 US2, FR-010): an item whose evidence cites
    // an injected chunk is refused, because the chunk never becomes teaching material.
    const injectionSignals = detectInjectionAttempts(await allChunks(owner, gap.id, deps));
    for (const signal of injectionSignals) {
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

    /* ---------------------------------- personalisation inputs (E24 US4, R7, FR-016) */
    // The curriculum is a function of gap + sources + diagnostic + learner profile + mastery
    // evidence. The profile lives on the user record (migration 006; defaults when absent);
    // the mastery evidence is the prior filled gaps' capability classification above plus a
    // summary of the evidence records behind them, rendered into the learner brief.
    const user = await uow.users.find(owner);
    const profile: LearnerProfileInput = {
      goals: user?.goals ?? [],
      preferredLessonLength: user?.preferredLessonLength ?? 'standard',
    };
    // FR-020: the review-due list is driven by the learner's evidence records, never a
    // hardcoded empty array. For each prior curriculum, map the evidence back to the capability
    // its objective teaches; an objective whose most recent evidence scores below the mastery
    // threshold is due for review inside the new curriculum (a recent weak signal means review,
    // not a silent assumption — review is additive, never a reteach).
    const priorCurricula: {
      readonly objectives: readonly { readonly id: string; readonly capabilityStatement: string }[];
      readonly evidence: readonly ReviewDueEvidence[];
    }[] = [];
    for (const filled of filledGaps) {
      const priorCurriculum = await uow.curricula.getCurrentForGap(owner, filled.id);
      if (!priorCurriculum) continue;
      priorCurricula.push({
        objectives: priorCurriculum.plan.objectives.map((o) => ({
          id: o.id,
          capabilityStatement: o.capabilityStatement,
        })),
        evidence: await uow.mastery.listEvidenceForCurriculum(owner, priorCurriculum.id),
      });
    }
    const priorEvidenceRecords = priorCurricula.reduce(
      (sum, curriculum) => sum + curriculum.evidence.length,
      0,
    );
    const mastery: MasteryInput = {
      satisfied: priorReuse.satisfied,
      decayed: priorReuse.decayed,
      reviewDue: reviewDueFromPriorCurricula({ curricula: priorCurricula }),
      evidenceSummary:
        priorEvidenceRecords > 0
          ? `${priorEvidenceRecords} recorded evidence item(s) across prior filled gaps.`
          : '',
    };

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
    const planInputs = derivePlanInputs({ normalisation, diagnostic, profile, mastery });
    const learnerBrief = [
      `The learner stated: "${gap.rawStatement}".`,
      `The learner has ${gap.dailyMinutes} minutes per day.`,
      `Normalisation — topic: ${normalisation.topic}. Current state: ${normalisation.currentState}. ` +
        `Target capability: ${normalisation.targetCapability}. Observable success condition: ` +
        normalisation.observableSuccessCondition,
      ...planInputs.learnerBriefParts,
    ].join(' ');

    const planResult = await runStep(
      step,
      {
        step: 'plan_curriculum',
        inputVersion: hash([normalisation, diagnostic, priorReuse.satisfied, profile, mastery]),
      },
      async () =>
        planCurriculum({
          runId: run.id,
          owner,
          gapId: gap.id,
          learnerBrief,
          evidence,
          satisfiedExternalPrerequisites: planInputs.satisfiedExternalPrerequisites,
          deps,
          logger,
        }),
    );
    // The step output is the full { plan, attempts } record (C-04); the run's curriculum is the
    // accepted plan after deterministic personalisation (US4). The attempts stay in the step log
    // — that is what the hit-rate harness reads.
    let plan = planResult.plan;

    // Personalise the plan deterministically from the five inputs, and never store an adapted
    // plan the validation gate would reject (FR-013): adaptation may reshape teaching, but it
    // cannot make the plan invalid.
    plan = personalisePlan(plan, {
      gap: {
        rawStatement: gap.rawStatement,
        dailyMinutes: gap.dailyMinutes,
        ...(gap.deadline ? { deadline: gap.deadline } : {}),
      },
      diagnostic,
      profile,
      mastery,
    });
    const personalisationViolations = findPlanViolations(plan, {
      satisfiedExternalPrerequisites: planInputs.satisfiedExternalPrerequisites,
    });
    if (personalisationViolations.length > 0) {
      throw new DomainError(
        'objective_not_assessed',
        'Personalisation produced an invalid plan: ' +
          personalisationViolations.map((v) => v.message).join('; '),
        { violations: personalisationViolations.map((v) => v.message) },
      );
    }

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
          injectionSignals,
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
          injectionSignals,
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

/**
 * One planner call in a run: which invariants the output violated and whether it passed the full
 * validation gate. This is the record the hit-rate measurement reads (C-04, FR-012/FR-014) — a
 * rejected plan's violations are returned together so the repair round can fix all of them at
 * once and the weakest invariant stays diagnosable.
 */
export interface PlanAttempt {
  /** 1-based planner call within this run. */
  readonly attempt: number;
  /** Violation messages from `findPlanViolations`, empty when the plan passed. */
  readonly violations: readonly string[];
  /**
   * The violation codes (`DomainErrorCode`), one per `violations` entry, so the hit-rate
   * diagnosis counts rejections per invariant exactly (US3, FR-014). Optional for
   * backward-compatible reads of a step output recorded before this field existed.
   */
  readonly codes?: readonly string[];
  readonly passed: boolean;
}

/** The `plan_curriculum` step output: the accepted plan plus every attempt that produced it. */
export interface PlanCurriculumResult {
  readonly plan: CurriculumPlan;
  readonly attempts: readonly PlanAttempt[];
}

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
}): Promise<PlanCurriculumResult> => {
  const { runId, owner, gapId, evidence, deps, logger } = params;
  const attempts: PlanAttempt[] = [];
  let previousViolations: string[] = [];

  for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt++) {
    const response = await deps.providers.languageModel.generate({
      contract: CurriculumPlanContract,
      purpose: 'planning',
      temperature: 0,
      // Plans are the largest structured payload in the pipeline; DeepSeek's default output
      // cap (4096 tokens) truncates a long plan mid-JSON, which killed live compiles.
      maxOutputTokens: PLAN_MAX_OUTPUT_TOKENS,
      runId,
      userId: owner,
      subject: gapId,
      instruction:
        `${params.learnerBrief} Produce a curriculum plan that passes every invariant the ` +
        'product enforces. Work through this checklist before you output the plan; each item ' +
        'names the exact failure mode that rejects a plan, so a plan that fails any item comes ' +
        'back for repair.\n' +
        'CHECKLIST\n' +
        '(1) DAILY BUDGET ARITHMETIC: sum the estimatedMinutes of every activity on each day. ' +
        "The sum must be <= the learner's daily minutes. Do the arithmetic explicitly per day " +
        '— a day that is over budget is rejected outright. Failure mode: ' +
        'plan_exceeds_time_budget ("Day N needs X minutes but the learner has Y").\n' +
        '(2) TEACH-AND-ASSESS COVERAGE: every objective in the plan must appear in at least one ' +
        "day's objectiveIds, and no day may list an objective the plan does not declare. " +
        'Failure modes: objective_not_taught ("never scheduled" / "teaches X, which is not an ' +
        'objective").\n' +
        '(3) ASSESSMENT BLUEPRINT: exactly one blueprint entry per objective, each promising at ' +
        'least 2 retrieval and 1 application items, and no entry for an undeclared objective. ' +
        'Failure modes: objective_not_assessed.\n' +
        '(4) PREREQUISITE GRAPH: the prerequisiteObjectiveIds must form an acyclic graph, and ' +
        'every prerequisiteObjectiveId must name an objective the plan teaches. Failure modes: ' +
        'prerequisite_cycle (the cycle is named) and prerequisite_unmet (dangling dependency).\n' +
        '(5) EXTERNAL PREREQUISITES: copy externalPrerequisites VERBATIM from the list of what ' +
        'the learner is assumed to already hold — never invent, reword or reorder one. If a ' +
        'prerequisite is not on that list, either teach it as an objective or remove the ' +
        'dependency. Failure mode: prerequisite_unmet ("assumes X, which the learner has not ' +
        'been shown to hold").\n' +
        '(6) EVIDENCE GROUNDING: every source-grounded objective must cite locators from the ' +
        'evidence block; only an objective explicitly labelled general_knowledge may omit them. ' +
        'Failure mode: an objective "claims source grounding but cites no locator".\n' +
        '(7) LESSON SHAPE: an audio lesson is a five-minute listening activity (~750 spoken ' +
        'words), scheduled alongside practice activities that together fit the daily budget. ' +
        "Set estimatedMinutes to the activity's real length, not the day's total.\n" +
        '(8) DIFFICULTY PROGRESSION: targetDifficulty must not decrease across the course — ' +
        'later objectives are harder than earlier ones. Failure mode: a backwards ramp.\n' +
        'COMMON FAILURE MODES TO AVOID: inventing external prerequisites; listing an objective ' +
        'on a day but forgetting its blueprint entry; summing activities without including the ' +
        'review/recall items; a prerequisite cycle from objectives that depend on each other; ' +
        'citing a locator that is not in the evidence block.' +
        (previousViolations.length > 0
          ? ` The previous plan was rejected for: ${previousViolations.join('; ')}. ` +
            'Fix every one of them — each rejected invariant is a defect in the plan, not a suggestion.'
          : ''),
      evidence,
    });

    const violations = findPlanViolations(response.value, {
      satisfiedExternalPrerequisites: params.satisfiedExternalPrerequisites,
    });
    attempts.push({
      attempt,
      violations: violations.map((v) => v.message),
      codes: violations.map((v) => v.code),
      passed: violations.length === 0,
    });
    if (violations.length === 0) return { plan: response.value, attempts };

    previousViolations = violations.map((v) => v.message);
    deps.metrics.increment('repair_attempt_total', { stage: 'planning' });
    logger.warn('Plan rejected; asking the planner to repair every violation at once', {
      attempt,
      violations: violations.length,
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
  /** Chunks flagged as instruction-like (FR-010, E24 US2): items citing them are refused. */
  readonly injectionSignals: readonly { chunkId: string; excerpt: string }[];
  readonly step: StepContext;
  readonly runId: string;
  readonly owner: OwnerId;
  readonly deps: CompileDeps;
}

const compileDay = async (params: CompileDayParams): Promise<DayOutcome> => {
  const { dayPlan, plan, curriculumId, evidence, injectionSignals, step, runId, owner, deps } =
    params;
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
   * Generate a lesson package with contract retries. The model occasionally drops a field the
   * schema requires (the live gate caught a free-response question without a rubric); the plan
   * step repairs violations by quoting them back, and a lesson deserves the same courtesy —
   * otherwise one bad field fails the whole run. Retries are deterministic (temperature 0).
   */
  const generateLesson = async (
    instruction: string,
    temperature: number,
  ): Promise<LessonPackage> => {
    let previousIssues: readonly string[] = [];
    for (let attempt = 1; attempt <= MAX_LESSON_CONTRACT_ATTEMPTS; attempt += 1) {
      try {
        const response = await providers.languageModel.generate({
          contract: LessonPackageContract,
          purpose: 'teaching',
          temperature: attempt === 1 ? temperature : 0,
          maxOutputTokens: LESSON_MAX_OUTPUT_TOKENS,
          runId,
          userId: owner,
          subject: `day-${dayPlan.day}`,
          instruction:
            instruction +
            (previousIssues.length > 0
              ? ` The previous response failed validation: ${previousIssues.join('; ')}. Fix all of them.`
              : ''),
          evidence,
        });
        return response.value as LessonPackage;
      } catch (error) {
        if (!(error instanceof ProviderContractError)) throw error;
        previousIssues = error.issues;
        step.logger.warn('Lesson rejected by contract; asking the model to fix the violations', {
          attempt,
          issues: previousIssues.length,
        });
        metrics.increment('repair_attempt_total', { stage: 'lesson_contract' });
      }
    }
    throw new ProviderContractError(
      LessonPackageContract.name,
      LessonPackageContract.version,
      previousIssues,
    );
  };

  lesson = await runStep(
    step,
    { step: 'generate_lesson', subject: `day-${dayPlan.day}`, inputVersion: planVersion },
    async () =>
      generateLesson(
        `Write the Day ${dayPlan.day} lesson package against the approved plan. The plan, ` +
          'the glossary and the objective identifiers are fixed inputs: use the shared terms ' +
          'for the concepts they name and do not reinterpret an objective. ' +
          `Shared glossary: ${glossaryBrief}. Assessment blueprint for this day's objectives: ` +
          `${blueprintForDay}. Ship at least those item counts across the lesson's questions ` +
          '(application items may be marked transfer). The script must be written to be spoken ' +
          'aloud — roughly 750 words for five minutes, plain sentences, no bullet lists, no ' +
          'references to figures. The script is the teaching itself and must pass the four ' +
          'structural checks the verifier enforces, so hit all four on the first pass: ' +
          '(1) CONCRETE OPENING: open with a situation, question or problem the learner ' +
          'recognizes; never open with a statement about the lesson ("in this lesson…", "today ' +
          'we will…", "we will cover…"). (2) ONE IDEA PER SEGMENT: every segment (a paragraph, ' +
          'or a sentence when the script is one paragraph) teaches exactly one idea, in complete ' +
          'sentences, with no bullet or list markers. (3) WORKED EXAMPLE: work at least one ' +
          'example step by step INSIDE the script ("first…, then…", labelled steps) and declare ' +
          'it in examples so its text appears in the script — never merely reference a worked ' +
          'example. (4) CHECKPOINT: ask at least one checkpoint question aloud in the script AND ' +
          'declare it in pausePrompts with the exact prompt text, so the audio pauses and the ' +
          'learner must respond before the lesson continues. Set estimatedMinutes to the ' +
          "script's actual listening time " +
          "(about 5 minutes for 750 words), never the day's total budget. Every question " +
          'prompt must be unique within the lesson. Every claim drawn from the source ' +
          'evidence must cite a locator from the evidence. Only multiple-choice questions ' +
          'carry an options field, with at least three distinct options and the answer among ' +
          'them; every other question type omits options. Free-response questions MUST ship ' +
          'a concrete rubric on the first pass: grading criteria with at least 2-3 explicit ' +
          'checkpoints, a model answer, and partial-credit rules, so grading is checkable — ' +
          'never a bare non-empty string. Every other question type omits the rubric field ' +
          'entirely. Never emit null for any field: omit optional fields instead.',
        0.2,
      ),
  );

  const verificationContext = {
    glossaryTerms: plan.glossary.map((g) => g.term),
    targetDifficulty: new Map(
      plan.assessmentBlueprint.map((b) => [b.objectiveId, b.targetDifficulty]),
    ),
    plannedObjectiveIds: dayPlan.objectiveIds,
    injectionSignals,
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

    const verifyFindings = verifyLesson(
      {
        id: lessonId,
        day: lesson.day,
        objectiveIds: lesson.objectiveIds,
        script: lesson.script,
        transcript: lesson.transcript,
        estimatedMinutes: lesson.estimatedMinutes,
        questions: lesson.questions,
        examples: lesson.examples,
        pausePrompts: lesson.pausePrompts,
      },
      { ...verificationContext, independentSolutions: report.independentSolutions },
    );

    // Stage F2 (E24 US2, FR-009): a separate model pass audits the lesson for claims the
    // supplied sources do not support. Its findings merge into the same repair loop, so an
    // unresolved claim (`resolution: 'none'` → critical) is repaired or excluded, never
    // published, and every resolved claim is recorded with its resolution. Keyed by
    // hash(lesson): a repaired lesson is a new input and is audited again; a re-entered run
    // reuses the recorded audit output and never re-charges.
    const auditFindings = await auditLessonClaims({
      lessonId,
      lesson,
      evidence,
      step,
      runId,
      owner,
      day: dayPlan.day,
      repairAttempts,
      deps,
    });

    findings = [...verifyFindings, ...auditFindings];

    for (const finding of verifyFindings) {
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
      async () =>
        generateLesson(
          'Repair only the failed items in this lesson; leave everything else untouched. ' +
            'Findings to address: ' +
            decision.findings.map((f) => `${f.category}: ${f.finding}`).join(' | '),
          0,
        ),
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

      const recorded = await runStep(
        step,
        { step: 'synthesise_audio', subject: lessonId, inputVersion: hash(lesson.script) },
        async () => {
          const results = await mapWithConcurrency(
            segments,
            deps.concurrency ?? 3,
            async (segment) => {
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
            },
          );

          // Publication integrity: the audio must correspond to the transcript beside it. The
          // check runs inside the step, so a lesson is recorded as synthesised only once its
          // audio is verified, uploaded and recorded as artefacts — a re-entered run reuses the
          // recorded summary and never re-pays for synthesis.
          const failures = checkAudioIntegrity(segments, results, shortChecksum);
          if (failures.length > 0) {
            throw new Error(
              `Audio integrity check failed: ${failures.map((f) => f.code).join(', ')}`,
            );
          }

          for (const [index, result] of results.entries()) {
            await deps.storage.put(
              owner,
              result.storageKey,
              Uint8Array.from(result.bytes ?? []),
              result.mediaType,
            );
            await uow.curricula.addArtefact(owner, {
              // Deterministic: a resumed run re-enters the same artefacts instead of duplicating
              // them.
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

          // The step log records a small summary — per-segment checksums, total byte size,
          // segment count and storage keys — not the audio bytes themselves. The bytes already
          // live in object storage (the artefacts table holds each segment's key + checksum);
          // persisting them here as well is what turned a 7-day curriculum into 100+ MB of JSONB.
          return {
            checksum: results.map((result) => result.checksum),
            bytes: results.reduce((total, result) => total + result.bytes.byteLength, 0),
            segments: results.length,
            storageKey: results.map((result) => result.storageKey),
          } satisfies AudioSynthesisStepOutput;
        },
      );

      audioSegments = recorded.segments;
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

/**
 * Stage F2: the claim audit (E24 US2, C-05, FR-009).
 *
 * A separate model pass over the lesson that finds claims the supplied sources do not support,
 * and forces a recorded resolution before the lesson can publish. It is separate from the
 * generator and the verifier — a generator must not audit itself (`assertIndependentVerifier`
 * doctrine). The findings merge into the day's repair loop:
 *
 *   - `resolution: 'none'` (unresolved) → `critical` → `decideRepair` refuses the lesson;
 *   - `removed` / `repaired` / `labelled` → non-blocking, recorded as the finding's resolution
 *     (`excluded` / `repaired` / `accepted`), so the learner can see what was dropped, fixed or
 *     flagged as outside the sources.
 */
const auditLessonClaims = async (params: {
  lessonId: string;
  lesson: LessonPackage;
  evidence: readonly EvidenceItem[];
  step: StepContext;
  runId: string;
  owner: OwnerId;
  day: number;
  repairAttempts: number;
  deps: CompileDeps;
}): Promise<Finding[]> => {
  const { lessonId, lesson, evidence, step, runId, owner, day, repairAttempts, deps } = params;

  const audit = await runStep(
    step,
    // Keyed by the lesson content: a repaired lesson is a new input and is audited again; a
    // re-entered run reuses the recorded output and never re-charges (constitution §7).
    { step: 'audit_claims', subject: lessonId, inputVersion: hash(lesson) },
    async () =>
      (
        await deps.providers.languageModel.generate({
          contract: ClaimAuditContract,
          purpose: 'verification',
          temperature: 0,
          runId,
          userId: owner,
          subject: `day-${day}`,
          instruction:
            'Audit this lesson for claims the supplied evidence does not support. ' +
            'For every unsupported claim choose exactly one resolution: removed (drop the ' +
            'claim), repaired (cite a supportingLocator that resolves to the evidence), ' +
            'labelled (the claim is explicitly general knowledge or outside the sources), or ' +
            'none (unresolved — this blocks publication). Only report claims the sources ' +
            'genuinely do not support; do not nitpick phrasing.',
          evidence,
        })
      ).value,
  );

  const findings: Finding[] = [];
  for (const finding of audit.findings) {
    const resolved = finding.resolution !== 'none';
    const severity = resolved ? 'low' : 'critical';
    const repairStatus =
      finding.resolution === 'removed'
        ? 'excluded'
        : finding.resolution === 'repaired'
          ? 'repaired'
          : finding.resolution === 'labelled'
            ? 'accepted'
            : 'open';

    findings.push({
      category: 'unsupported_claim',
      severity,
      targetId: finding.targetId,
      finding: `Unsupported claim in day ${day}: "${finding.claim}" — resolution: ${finding.resolution}.`,
      suggestedRepair: resolved
        ? undefined
        : 'Remove the claim, repair it with a supporting locator, or label it as outside the sources.',
    });

    await step.generation.addFinding(owner, {
      id: deps.newId('finding'),
      runId,
      targetId: finding.targetId,
      category: 'unsupported_claim',
      severity,
      finding: `Unsupported claim in day ${day}: "${finding.claim}" — resolution: ${finding.resolution}.`,
      repairStatus,
      repairAttempts,
    });
    deps.metrics.increment('audit_finding_total', { category: 'unsupported_claim' });
  }

  return findings;
};

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
