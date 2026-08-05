/**
 * The structured contracts for every model call in the compilation pipeline.
 *
 * These schemas are the boundary between "a model said something" and "the system believes it".
 * Nothing is persisted that has not passed through one of them.
 */

import { z } from 'zod';
import { defineContract } from './versioning.js';

/* ------------------------------------------------------------------ shared pieces */

/** Where a claim came from in a source document, so a lesson can be traced back. */
export const SourceLocatorSchema = z
  .object({
    sourceId: z.string().min(1),
    chunkId: z.string().min(1),
    /** Human-meaningful position: "p. 12", "§2.3", "slide 4", "00:14:02". */
    locator: z.string().min(1),
  })
  .strict();
export type SourceLocator = z.infer<typeof SourceLocatorSchema>;

export const EVIDENCE_BASES = ['source', 'general_knowledge'] as const;
export type EvidenceBasis = (typeof EVIDENCE_BASES)[number];

/**
 * Every objective must declare what it rests on. `general_knowledge` is permitted but must be
 * explicit, so "unsupported claim" is a detectable state rather than an absence of information.
 */
export const EvidenceSchema = z
  .object({
    basis: z.enum(EVIDENCE_BASES),
    locators: z.array(SourceLocatorSchema).default([]),
  })
  .strict()
  .refine((e) => e.basis === 'general_knowledge' || e.locators.length > 0, {
    message: 'An objective grounded in a source must cite at least one locator.',
  });

export const QUESTION_TYPES = ['multiple_choice', 'short_answer', 'worked_problem'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/**
 * `retrieval` checks recall; `application` requires using the idea on a new instance; `transfer`
 * requires it in an unfamiliar setting. The mastery rule needs at least one non-retrieval item,
 * which is why the distinction is in the contract rather than left to prose.
 */
export const QUESTION_ROLES = ['retrieval', 'application', 'transfer'] as const;
export type QuestionRole = (typeof QUESTION_ROLES)[number];

export const QuestionSchema = z
  .object({
    id: z.string().min(1),
    objectiveId: z.string().min(1),
    type: z.enum(QUESTION_TYPES),
    role: z.enum(QUESTION_ROLES),
    /** 1 (recall) to 5 (novel synthesis). Checked against the assessment blueprint. */
    difficulty: z.number().int().min(1).max(5),
    prompt: z.string().min(1),
    /** Required for multiple choice, forbidden otherwise. */
    options: z.array(z.string().min(1)).optional(),
    answer: z.string().min(1),
    /** Required when the answer is not exactly checkable, so grading is not a vibe. */
    rubric: z.string().optional(),
    /** Alternative formulations a rubric must accept. Guards against over-strict grading. */
    acceptableAlternatives: z.array(z.string()).default([]),
    evidence: EvidenceSchema,
    hint: z.string().optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.type === 'multiple_choice') {
      if (!q.options || q.options.length < 3) {
        ctx.addIssue({
          code: 'custom',
          message: 'A multiple-choice question needs at least three options.',
          path: ['options'],
        });
      } else if (!q.options.includes(q.answer)) {
        ctx.addIssue({
          code: 'custom',
          message: 'The answer to a multiple-choice question must be one of its options.',
          path: ['answer'],
        });
      } else if (new Set(q.options).size !== q.options.length) {
        ctx.addIssue({
          code: 'custom',
          message: 'Multiple-choice options must be distinct.',
          path: ['options'],
        });
      }
    } else if (q.options) {
      ctx.addIssue({
        code: 'custom',
        message: 'Only a multiple-choice question may carry options.',
        path: ['options'],
      });
    }

    if (q.type !== 'multiple_choice' && !q.rubric) {
      ctx.addIssue({
        code: 'custom',
        message: 'A free-response question must ship with a rubric.',
        path: ['rubric'],
      });
    }
  });
export type Question = z.infer<typeof QuestionSchema>;

/* ------------------------------------------------------ stage A: gap normalisation */

export const AMBIGUITY_MATERIALITY = ['blocking', 'recorded_assumption'] as const;

export const GapNormalisationContract = defineContract('gap_normalisation', '1.0.0', {
  topic: z.string().min(1),
  currentState: z.string().min(1),
  targetCapability: z.string().min(1),
  /** How we would know the learner got there. Must be observable, not "understands X". */
  observableSuccessCondition: z.string().min(1),
  assumedPrerequisites: z.array(z.string().min(1)).default([]),
  ambiguities: z
    .array(
      z
        .object({
          question: z.string().min(1),
          /**
           * `blocking` means the curriculum would be materially different depending on the
           * answer, so we ask. Anything else is recorded as a labelled assumption and we proceed.
           */
          materiality: z.enum(AMBIGUITY_MATERIALITY),
          assumptionIfUnanswered: z.string().min(1),
        })
        .strict(),
    )
    .default([]),
  recommendedDiagnostic: z
    .object({
      questionCount: z.number().int().min(5).max(10),
      focusAreas: z.array(z.string().min(1)).min(1),
    })
    .strict(),
});
export type GapNormalisation = z.infer<typeof GapNormalisationContract.schema>;

/* ------------------------------------------------- stage C: diagnostic interpretation */

export const DiagnosticInterpretationContract = defineContract(
  'diagnostic_interpretation',
  '1.0.0',
  {
    /** Objectives the learner already demonstrates, which the plan should not reteach. */
    demonstratedCapabilities: z.array(z.string().min(1)).default([]),
    knowledgeGaps: z.array(z.string().min(1)).default([]),
    /** True when the learner skipped, so the baseline is inferred and must be labelled. */
    inferred: z.boolean(),
    baselineConfidence: z.number().min(0).max(1),
    recommendedStartingDifficulty: z.number().int().min(1).max(5),
  },
);
export type DiagnosticInterpretation = z.infer<typeof DiagnosticInterpretationContract.schema>;

/* ------------------------------------------------------- stage D: curriculum plan */

export const ObjectiveSchema = z
  .object({
    id: z.string().min(1),
    /** A measurable capability statement: "state and apply the definition of an equivalence class". */
    capabilityStatement: z.string().min(1),
    required: z.boolean(),
    prerequisiteObjectiveIds: z.array(z.string()).default([]),
    /** Prerequisites the learner is assumed to hold coming in, not taught by this curriculum. */
    externalPrerequisites: z.array(z.string()).default([]),
    evidence: EvidenceSchema,
  })
  .strict();
export type Objective = z.infer<typeof ObjectiveSchema>;

export const ACTIVITY_KINDS = ['audio_lesson', 'retrieval', 'application', 'review'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const DayPlanSchema = z
  .object({
    day: z.number().int().min(1).max(7),
    title: z.string().min(1),
    objectiveIds: z.array(z.string().min(1)).min(1),
    activities: z
      .array(
        z
          .object({
            kind: z.enum(ACTIVITY_KINDS),
            description: z.string().min(1),
            estimatedMinutes: z.number().int().min(1).max(60),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type DayPlan = z.infer<typeof DayPlanSchema>;

export const CurriculumPlanContract = defineContract('curriculum_plan', '1.0.0', {
  gapId: z.string().min(1),
  dailyMinutes: z.number().int().min(15).max(60),
  objectives: z.array(ObjectiveSchema).min(1),
  days: z.array(DayPlanSchema).min(1).max(7),
  /** The immutable terminology contract shared by every parallel lesson generation. */
  glossary: z
    .array(z.object({ term: z.string().min(1), definition: z.string().min(1) }).strict())
    .default([]),
  /** What this curriculum deliberately does not cover, so scope creep is visible. */
  exclusions: z.array(z.string()).default([]),
  assessmentBlueprint: z
    .array(
      z
        .object({
          objectiveId: z.string().min(1),
          retrievalItems: z.number().int().min(0),
          applicationItems: z.number().int().min(0),
          targetDifficulty: z.number().int().min(1).max(5),
        })
        .strict(),
    )
    .min(1),
});
export type CurriculumPlan = z.infer<typeof CurriculumPlanContract.schema>;

/* ---------------------------------------------------------- stage E: lesson package */

export const LessonPackageContract = defineContract('lesson_package', '2.0.0', {
  day: z.number().int().min(1).max(7),
  title: z.string().min(1),
  objectiveIds: z.array(z.string().min(1)).min(1),
  /**
   * v2: the long prose (script, transcript, summary) moved to the `lesson_script` contract.
   * Providers cap structured output (~4096 tokens in json_object mode), and a 750-word script
   * plus questions routinely exceeded it — the response truncated mid-JSON and the run died.
   * The pipeline generates the script first, then this compact package, and assembles the
   * full lesson (see compile.ts).
   */
  examples: z.array(z.string().min(1)).default([]),
  /** Prompts embedded in the audio that force a response before continuing. */
  pausePrompts: z
    .array(
      z
        .object({
          atSecond: z.number().int().min(0),
          prompt: z.string().min(1),
          expectedAnswer: z.string().min(1),
        })
        .strict(),
    )
    .default([]),
  questions: z.array(QuestionSchema).min(1),
  estimatedMinutes: z.number().int().min(1).max(60),
  /** Any visual must ship with text that carries the same information. */
  visual: z
    .object({ description: z.string().min(1), accessibilityText: z.string().min(1) })
    .strict()
    .optional(),
  evidence: EvidenceSchema,
});
/**
 * The assembled lesson: the v2 package plus the separately generated spoken prose. Everything
 * downstream (verification, evaluation, the study surface) consumes this assembled shape.
 */
export type LessonPackage = z.infer<typeof LessonPackageContract.schema> & {
  readonly script: string;
  readonly transcript: string;
  readonly summary: string;
};

/** The spoken prose for one lesson, generated separately from the structured package. */
export const LessonScriptContract = defineContract('lesson_script', '1.0.0', {
  day: z.number().int().min(1).max(7),
  /** Written to be spoken: no bullet points, no "as shown in the figure". */
  script: z.string().min(1),
  transcript: z.string().min(1),
  summary: z.string().min(1),
});
export type LessonScript = z.infer<typeof LessonScriptContract.schema>;
/** The raw v2 package shape (before the pipeline assembles the spoken prose). */
export type LessonPackageContractOutput = z.infer<typeof LessonPackageContract.schema>;

/* ------------------------------------------------------- stage F: verification report */

export const VERIFICATION_CATEGORIES = [
  'independent_solution',
  'distractor_validity',
  'rubric_tolerance',
  'answer_leakage',
  'difficulty_match',
  'logical_consistency',
  'source_support',
  'spoken_clarity',
  'duration_estimate',
  'objective_coverage',
  'prompt_injection',
] as const;
export type VerificationCategory = (typeof VERIFICATION_CATEGORIES)[number];

export const FINDING_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const VerificationReportContract = defineContract('verification_report', '1.0.0', {
  artefactId: z.string().min(1),
  /**
   * The verifier's own answers, produced without seeing the published answer. `agrees: false` on
   * an independent solve is the single most valuable signal the pipeline produces.
   */
  independentSolutions: z
    .array(
      z
        .object({
          questionId: z.string().min(1),
          answer: z.string().min(1),
          agrees: z.boolean(),
          reasoningSummary: z.string().min(1),
        })
        .strict(),
    )
    .default([]),
  findings: z
    .array(
      z
        .object({
          category: z.enum(VERIFICATION_CATEGORIES),
          severity: z.enum(FINDING_SEVERITIES),
          targetId: z.string().min(1),
          finding: z.string().min(1),
          suggestedRepair: z.string().optional(),
        })
        .strict(),
    )
    .default([]),
});
export type VerificationReport = z.infer<typeof VerificationReportContract.schema>;

/* ----------------------------------------------------------------- stage G: repair */

export const RepairResultContract = defineContract('repair_result', '1.0.0', {
  targetId: z.string().min(1),
  /** Only the failed artefact is regenerated; the rest of the curriculum is untouched. */
  repairedQuestions: z.array(QuestionSchema).default([]),
  repairedScript: z.string().optional(),
  addressedFindings: z.array(z.string().min(1)).min(1),
});
export type RepairResult = z.infer<typeof RepairResultContract.schema>;

export const ALL_CONTRACTS = {
  gap_normalisation: GapNormalisationContract,
  diagnostic_interpretation: DiagnosticInterpretationContract,
  curriculum_plan: CurriculumPlanContract,
  lesson_package: LessonPackageContract,
  lesson_script: LessonScriptContract,
  verification_report: VerificationReportContract,
  repair_result: RepairResultContract,
} as const;
