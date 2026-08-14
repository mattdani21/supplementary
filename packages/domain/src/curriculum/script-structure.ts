/**
 * The four human-sounding structural elements (E24 US1, C-02).
 *
 * Lessons must read like a real teacher wrote them, not like a model dump: a concrete opening
 * (not a statement about the lesson), one idea per segment, a worked example inside the script,
 * and a checkpoint question that pauses the learner. These deterministic detectors are the
 * single source of truth for both the evaluation scorer (`scoreHumanSounding`) and the domain
 * verifier (`checkLessonStructure`), so the two can never disagree about what "human-sounding"
 * means.
 *
 * The checks are deliberately conservative — a false accusation fails a correct lesson, which
 * is worse than a missed one. Every rule is documented in
 * `packages/evaluation/HUMAN_SOUNDING_RUBRIC.md` alongside the published floor.
 */

export type StructureElement =
  'concrete_opening' | 'single_idea_per_segment' | 'worked_example' | 'checkpoint';

export interface StructureCheck {
  readonly element: StructureElement;
  readonly passes: boolean;
  /** Human-readable detail naming the failure; present only when the check fails. */
  readonly detail?: string;
}

export interface StructureCheckInput {
  readonly script: string;
  readonly examples?: readonly string[];
  readonly pausePrompts?: readonly { prompt: string }[];
}

/** Human-readable element labels, used in observations and findings. */
export const STRUCTURE_ELEMENT_LABELS: Readonly<Record<StructureElement, string>> = {
  concrete_opening: 'concrete opening',
  single_idea_per_segment: 'single idea per segment',
  worked_example: 'worked example',
  checkpoint: 'checkpoint question',
};

const normalise = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Openings that talk about the lesson, the curriculum or the generation process instead of the
 * subject — the signature of a model dump (FR-001). Matched against the normalised first
 * sentence, so "Today we are going to earn one sentence." (a subject-led opening) passes while
 * "In this lesson we will cover…" fails.
 */
const META_OPENING_PATTERNS = [
  'in this lesson',
  'this lesson will',
  'in this chapter',
  'today we will',
  'we will cover',
  'welcome to',
  "let's learn about",
  'let us learn about',
  'this module',
  'the lesson',
  'the course',
  'the generation',
] as const;

const firstSentence = (script: string): string => {
  const match = /^([^.!?]+[.!?]?)/.exec(script.trim());
  return match?.[1]?.trim() ?? script.trim();
};

export const checkConcreteOpening = (script: string): StructureCheck => {
  const opening = firstSentence(script);
  const normalised = normalise(opening);
  const wordCount = opening.split(/\s+/).filter(Boolean).length;
  const metaOpening = META_OPENING_PATTERNS.some((pattern) => normalised.includes(pattern));
  if (metaOpening) {
    return {
      element: 'concrete_opening',
      passes: false,
      detail: `No concrete opening — opens with a statement about the lesson: "${opening}"`,
    };
  }
  if (wordCount < 5) {
    return {
      element: 'concrete_opening',
      passes: false,
      detail: `No concrete opening — first sentence is too short to teach: "${opening}"`,
    };
  }
  return { element: 'concrete_opening', passes: true };
};

/**
 * Segments are paragraphs when the script has several, else sentences (a spoken script is one
 * paragraph by design). Every segment must be a complete, terminal-punctuated sentence that
 * does not start with a list marker — bulleted or enumerated prose cannot be taught aloud
 * (FR-002).
 */
export const checkSingleIdeaPerSegment = (script: string): StructureCheck => {
  const paragraphs = script
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const segments =
    paragraphs.length >= 2
      ? paragraphs
      : script
          .split(/(?<=[.!?])\s+/)
          .map((part) => part.trim())
          .filter(Boolean);

  if (segments.length < 2) {
    return {
      element: 'single_idea_per_segment',
      passes: false,
      detail: 'The script has fewer than two segments, so no idea is built one step at a time.',
    };
  }

  for (const segment of segments) {
    if (/^[-*•\d.)]/.test(segment)) {
      return {
        element: 'single_idea_per_segment',
        passes: false,
        detail: `A segment starts with a list marker instead of teaching one idea: "${segment.slice(0, 60)}"`,
      };
    }
    if (!/[.!?…]$/.test(segment)) {
      return {
        element: 'single_idea_per_segment',
        passes: false,
        detail: `A segment is not a complete sentence: "${segment.slice(0, 60)}"`,
      };
    }
  }

  return { element: 'single_idea_per_segment', passes: true };
};

/**
 * A worked example must be worked *within* the script (FR-003): either a declared example whose
 * text appears in the script, or a step-by-step block — a named sequence ("first … second …"),
 * or a labelled argument ("Reflexive: … Symmetric: … Transitive: …").
 */
const hasStepBlock = (script: string): boolean => {
  const normalised = normalise(script);

  const stepMarkers = new Set<string>();
  for (const match of normalised.matchAll(/\b(first|second|third|next|then|step)\b/g)) {
    stepMarkers.add(match[1]!);
  }
  // "first … second …" or "first … then …": a real sequence, not a single stray "then".
  if (stepMarkers.size >= 2) return true;

  // Sentence-initial labelled steps: "Reflexive: … Symmetric: …" — a worked argument.
  const labelledSteps = [...normalised.matchAll(/(?:^|\.\s)([a-z]+)\s*:/g)].length;
  return labelledSteps >= 2;
};

export const checkWorkedExample = (input: StructureCheckInput): StructureCheck => {
  const normalisedScript = normalise(input.script);

  for (const example of input.examples ?? []) {
    const normalisedExample = normalise(example);
    if (normalisedExample.length > 0 && normalisedScript.includes(normalisedExample)) {
      return { element: 'worked_example', passes: true };
    }
  }

  if (hasStepBlock(input.script)) {
    return { element: 'worked_example', passes: true };
  }

  return {
    element: 'worked_example',
    passes: false,
    detail: 'The script never works an example step by step.',
  };
};

/**
 * A checkpoint question must pause the learner (FR-004): the lesson declares a pause prompt and
 * the script actually asks the question, so the pause is part of the teaching rather than a
 * bolted-on form.
 */
export const checkCheckpoint = (input: StructureCheckInput): StructureCheck => {
  const prompts = input.pausePrompts ?? [];
  if (prompts.length === 0) {
    return {
      element: 'checkpoint',
      passes: false,
      detail: 'The lesson has no checkpoint question (no pause prompt).',
    };
  }

  const prompt = prompts[0]!.prompt;
  if (normalise(input.script).includes(normalise(prompt))) {
    return { element: 'checkpoint', passes: true };
  }

  return {
    element: 'checkpoint',
    passes: false,
    detail: `The checkpoint question is never asked in the script: "${prompt}"`,
  };
};

/** Run all four element checks against a script-shaped input. */
export const checkStructuralElements = (input: StructureCheckInput): readonly StructureCheck[] => [
  checkConcreteOpening(input.script),
  checkSingleIdeaPerSegment(input.script),
  checkWorkedExample(input),
  checkCheckpoint(input),
];

/** The four checks as a single pass/fail decision, with the failing element named. */
export const passesStructuralElements = (input: StructureCheckInput): boolean =>
  checkStructuralElements(input).every((check) => check.passes);
