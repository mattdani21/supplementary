/**
 * The reference curriculum the fake provider produces.
 *
 * This is the deterministic content the whole vertical slice runs on. It is a real, coherent
 * three-day course on relations and equivalence classes, grounded in the set-theory primer, so
 * the tests exercise plausible content rather than lorem ipsum — a test that passes on "aaa"
 * would not catch a coverage or leakage bug.
 */

import type {
  CurriculumPlan,
  DiagnosticInterpretation,
  GapNormalisation,
  LessonPackage,
  Question,
  VerificationReport,
} from '@gapos/ai-contracts';
import { SET_THEORY_SOURCE_ID } from './set-theory-source.js';

const at = (chunkId: string, locator: string) => ({
  sourceId: SET_THEORY_SOURCE_ID,
  chunkId,
  locator,
});

const sourced = (chunkId: string, locator: string) => ({
  basis: 'source' as const,
  locators: [at(chunkId, locator)],
});

export const REFERENCE_GAP_STATEMENT =
  'I understand basic set notation but need relations and proof techniques by Friday. ' +
  'I have 35 minutes per day.';

export const referenceNormalisation = (): GapNormalisation => ({
  schemaVersion: '1.0.0',
  topic: 'Relations, equivalence classes and proof by double inclusion',
  currentState: 'Reads set-builder notation and basic operations, has not written proofs.',
  targetCapability:
    'State the relation properties precisely, prove a relation is an equivalence relation, ' +
    'and prove a set equality by double inclusion.',
  observableSuccessCondition:
    'Given an unfamiliar relation, the learner writes a correct proof that it is or is not an ' +
    'equivalence relation, and proves one set identity by double inclusion, without hints.',
  assumedPrerequisites: ['set-builder notation', 'union, intersection and difference'],
  ambiguities: [
    {
      question: 'Is the target an exam, or applying the technique in a specific piece of work?',
      materiality: 'recorded_assumption',
      assumptionIfUnanswered:
        'Assumed general fluency rather than a specific syllabus; the plan covers the standard ' +
        'definitions and one transfer task.',
    },
  ],
  recommendedDiagnostic: {
    questionCount: 5,
    focusAreas: ['set notation', 'subset reasoning', 'quantifier handling'],
  },
});

export const referenceDiagnostic = (
  over: Partial<DiagnosticInterpretation> = {},
): DiagnosticInterpretation => ({
  schemaVersion: '1.0.0',
  demonstratedCapabilities: ['set-builder notation', 'union and intersection'],
  knowledgeGaps: ['double inclusion', 'relation properties', 'equivalence classes'],
  inferred: false,
  baselineConfidence: 0.72,
  recommendedStartingDifficulty: 2,
  ...over,
});

export const REFERENCE_OBJECTIVES = [
  {
    id: 'obj_subset_proof',
    capabilityStatement:
      'Prove that one set is a subset of another by taking an arbitrary element and deriving ' +
      'membership.',
    required: true,
    prerequisiteObjectiveIds: [] as string[],
    externalPrerequisites: ['set-builder notation'],
    evidence: sourced('chunk_2', '§2 Subsets and set equality'),
  },
  {
    id: 'obj_double_inclusion',
    capabilityStatement: 'Prove a set equality by double inclusion.',
    required: true,
    prerequisiteObjectiveIds: ['obj_subset_proof'],
    externalPrerequisites: [] as string[],
    evidence: sourced('chunk_3', '§3 Operations on sets'),
  },
  {
    id: 'obj_relation_properties',
    capabilityStatement:
      'State and test reflexivity, symmetry, transitivity and antisymmetry for a given relation.',
    required: true,
    prerequisiteObjectiveIds: [] as string[],
    externalPrerequisites: [] as string[],
    evidence: sourced('chunk_5', '§5 Relations'),
  },
  {
    id: 'obj_equivalence_classes',
    capabilityStatement:
      'Prove a relation is an equivalence relation and describe the partition its classes induce.',
    required: true,
    prerequisiteObjectiveIds: ['obj_relation_properties', 'obj_double_inclusion'],
    externalPrerequisites: [] as string[],
    evidence: sourced('chunk_6', '§6 Equivalence relations and classes'),
  },
] as const;

export const referencePlan = (gapId = 'gap_reference'): CurriculumPlan => ({
  schemaVersion: '1.0.0',
  gapId,
  dailyMinutes: 35,
  objectives: REFERENCE_OBJECTIVES.map((o) => ({
    ...o,
    prerequisiteObjectiveIds: [...o.prerequisiteObjectiveIds],
    externalPrerequisites: [...o.externalPrerequisites],
  })),
  days: [
    {
      day: 1,
      title: 'Arbitrary elements and the subset argument',
      objectiveIds: ['obj_subset_proof'],
      activities: [
        {
          kind: 'audio_lesson',
          description: 'Why "arbitrary" carries the proof',
          estimatedMinutes: 12,
        },
        { kind: 'retrieval', description: 'Recall the subset definition', estimatedMinutes: 8 },
        { kind: 'application', description: 'Prove a subset claim', estimatedMinutes: 15 },
      ],
    },
    {
      day: 2,
      title: 'Double inclusion and the distributive laws',
      objectiveIds: ['obj_double_inclusion'],
      activities: [
        { kind: 'review', description: 'Yesterday’s subset argument', estimatedMinutes: 5 },
        {
          kind: 'audio_lesson',
          description: 'Both directions, and why each is needed',
          estimatedMinutes: 13,
        },
        { kind: 'application', description: 'Prove one distributive law', estimatedMinutes: 17 },
      ],
    },
    {
      day: 3,
      title: 'Relations, equivalence and partitions',
      objectiveIds: ['obj_relation_properties', 'obj_equivalence_classes'],
      activities: [
        { kind: 'review', description: 'Double inclusion recall', estimatedMinutes: 5 },
        {
          kind: 'audio_lesson',
          description: 'The three properties and what they buy',
          estimatedMinutes: 14,
        },
        { kind: 'application', description: 'Prove an equivalence relation', estimatedMinutes: 16 },
      ],
    },
  ],
  glossary: [
    {
      term: 'arbitrary element',
      definition: 'A chosen element about which nothing beyond its membership is assumed.',
    },
    {
      term: 'double inclusion',
      definition: 'Proving A = B by proving A subset-of B and B subset-of A.',
    },
    { term: 'equivalence relation', definition: 'A reflexive, symmetric and transitive relation.' },
    {
      term: 'equivalence class',
      definition: 'The set of all elements related to a given element.',
    },
    {
      term: 'partition',
      definition: 'A division of a set into non-empty, pairwise disjoint pieces covering it.',
    },
  ],
  exclusions: [
    'Cardinality and countability',
    'Order relations beyond the antisymmetry definition',
    'Axiomatic set theory',
  ],
  assessmentBlueprint: [
    {
      objectiveId: 'obj_subset_proof',
      retrievalItems: 2,
      applicationItems: 1,
      targetDifficulty: 2,
    },
    {
      objectiveId: 'obj_double_inclusion',
      retrievalItems: 2,
      applicationItems: 1,
      targetDifficulty: 3,
    },
    {
      objectiveId: 'obj_relation_properties',
      retrievalItems: 2,
      applicationItems: 1,
      targetDifficulty: 2,
    },
    {
      objectiveId: 'obj_equivalence_classes',
      retrievalItems: 2,
      applicationItems: 1,
      targetDifficulty: 4,
    },
  ],
});

/* --------------------------------------------------------------------- lessons */

const questionsForDay = (day: number): Question[] => {
  if (day === 1) {
    return [
      {
        id: 'q_d1_r1',
        objectiveId: 'obj_subset_proof',
        type: 'multiple_choice',
        role: 'retrieval',
        difficulty: 1,
        prompt: 'A is a subset of B exactly when:',
        options: [
          'every element of A is an element of B',
          'A and B have the same elements',
          'some element of A is an element of B',
          'A and B share no elements',
        ],
        answer: 'every element of A is an element of B',
        acceptableAlternatives: [],
        evidence: sourced('chunk_2', '§2 Subsets and set equality'),
      },
      {
        id: 'q_d1_r2',
        objectiveId: 'obj_subset_proof',
        type: 'short_answer',
        role: 'retrieval',
        difficulty: 2,
        prompt:
          'In a subset proof we take an arbitrary element of the left-hand set. What may the ' +
          'rest of the argument assume about it?',
        answer: 'Only that it belongs to the left-hand set.',
        rubric:
          'Accept any answer stating that no property beyond membership may be assumed. Reject ' +
          'answers naming a specific element or an extra property.',
        acceptableAlternatives: [
          'Nothing except that it is a member of the left set.',
          'Only its membership; no other property.',
        ],
        evidence: sourced('chunk_2', '§2 Subsets and set equality'),
      },
      {
        id: 'q_d1_a1',
        objectiveId: 'obj_subset_proof',
        type: 'worked_problem',
        role: 'application',
        difficulty: 3,
        prompt: 'Prove that A intersect B is a subset of A.',
        answer:
          'Let x be an arbitrary element of A intersect B. By the definition of intersection, ' +
          'x is in A and x is in B. In particular x is in A. Since x was arbitrary, every ' +
          'element of A intersect B is in A, so A intersect B is a subset of A.',
        rubric:
          'Full marks require: an arbitrary element introduced; the definition of intersection ' +
          'applied; the conclusion generalised. Deduct for reasoning about a specific element.',
        acceptableAlternatives: [],
        evidence: sourced('chunk_3', '§3 Operations on sets'),
        hint: 'Start with "Let x be an arbitrary element of A intersect B."',
      },
    ];
  }

  if (day === 2) {
    return [
      {
        id: 'q_d2_r1',
        objectiveId: 'obj_double_inclusion',
        type: 'multiple_choice',
        role: 'retrieval',
        difficulty: 2,
        prompt: 'To prove A = B by double inclusion you must show:',
        options: [
          'A subset-of B and B subset-of A',
          'A subset-of B only',
          'A and B are both non-empty',
          'A intersect B is non-empty',
        ],
        answer: 'A subset-of B and B subset-of A',
        acceptableAlternatives: [],
        evidence: sourced('chunk_2', '§2 Subsets and set equality'),
      },
      {
        id: 'q_d2_r2',
        objectiveId: 'obj_double_inclusion',
        type: 'short_answer',
        role: 'retrieval',
        difficulty: 2,
        prompt: 'Why is one inclusion not enough to establish equality?',
        answer: 'Because the larger set may contain elements the smaller one does not.',
        rubric:
          'Accept any answer noting that a single inclusion permits a strict subset. Reject ' +
          'answers that restate the definition without addressing strictness.',
        acceptableAlternatives: ['Because A could be a proper subset of B.'],
        evidence: sourced('chunk_2', '§2 Subsets and set equality'),
      },
      {
        id: 'q_d2_a1',
        objectiveId: 'obj_double_inclusion',
        type: 'worked_problem',
        role: 'application',
        difficulty: 4,
        prompt:
          'Prove A intersect (B union C) = (A intersect B) union (A intersect C) by double ' +
          'inclusion.',
        answer:
          'Left to right: let x be arbitrary in A intersect (B union C). Then x is in A, and x ' +
          'is in B or in C. If x is in B then x is in A intersect B; otherwise x is in C and so ' +
          'x is in A intersect C. Either way x lies in the union. Right to left: let x be in ' +
          '(A intersect B) union (A intersect C). In both cases x is in A, and x is in B or in ' +
          'C, so x is in A intersect (B union C). Both inclusions hold, so the sets are equal.',
        rubric:
          'Full marks require both directions, an arbitrary element in each, and a case split on ' +
          'the union. One direction alone scores at most half.',
        acceptableAlternatives: [],
        evidence: sourced('chunk_3', '§3 Operations on sets'),
        hint: 'Do the two directions as separate paragraphs; each starts with an arbitrary x.',
      },
    ];
  }

  return [
    {
      id: 'q_d3_r1',
      objectiveId: 'obj_relation_properties',
      type: 'multiple_choice',
      role: 'retrieval',
      difficulty: 2,
      prompt: 'The empty relation on a non-empty set A is:',
      options: [
        'symmetric and transitive but not reflexive',
        'reflexive, symmetric and transitive',
        'reflexive but not symmetric',
        'none of the three properties',
      ],
      answer: 'symmetric and transitive but not reflexive',
      acceptableAlternatives: [],
      evidence: sourced('chunk_5', '§5 Relations'),
    },
    {
      id: 'q_d3_r2',
      objectiveId: 'obj_relation_properties',
      type: 'short_answer',
      role: 'retrieval',
      difficulty: 2,
      prompt: 'State what must hold for a relation R on A to be transitive.',
      answer: 'Whenever a R b and b R c, it follows that a R c.',
      rubric:
        'Accept any correct statement of the conditional. Reject answers omitting either hypothesis.',
      acceptableAlternatives: ['If aRb and bRc then aRc.'],
      evidence: sourced('chunk_5', '§5 Relations'),
    },
    {
      id: 'q_d3_a1',
      objectiveId: 'obj_equivalence_classes',
      type: 'worked_problem',
      role: 'transfer',
      difficulty: 5,
      prompt:
        'On the set of integers define a R b when a - b is divisible by 5. Prove R is an ' +
        'equivalence relation and describe its classes.',
      answer:
        'Reflexive: a - a = 0, divisible by 5. Symmetric: if a - b = 5k then b - a = 5(-k). ' +
        'Transitive: if a - b = 5k and b - c = 5m then a - c = 5(k + m). So R is an equivalence ' +
        'relation. Its classes are the five residue classes modulo 5.',
      rubric:
        'Full marks require all three properties argued from the divisibility definition and the ' +
        'five classes identified. Asserting a property without argument scores zero for it.',
      acceptableAlternatives: [],
      evidence: sourced('chunk_6', '§6 Equivalence relations and classes'),
      hint: 'Write a - b = 5k and manipulate.',
    },
    {
      id: 'q_d3_r3',
      objectiveId: 'obj_equivalence_classes',
      type: 'short_answer',
      role: 'retrieval',
      difficulty: 3,
      prompt: 'What is the relationship between the equivalence classes of R and the set A?',
      answer: 'They partition A: every element lies in exactly one class.',
      rubric: 'Accept any answer conveying disjointness and coverage.',
      acceptableAlternatives: ['The classes are disjoint and cover A.'],
      evidence: sourced('chunk_6', '§6 Equivalence relations and classes'),
    },
    {
      id: 'q_d3_r4',
      objectiveId: 'obj_equivalence_classes',
      type: 'multiple_choice',
      role: 'retrieval',
      difficulty: 3,
      prompt: 'Two equivalence classes of the same relation that share an element must be:',
      options: ['identical', 'disjoint', 'nested', 'of the same size but distinct'],
      answer: 'identical',
      acceptableAlternatives: [],
      evidence: sourced('chunk_6', '§6 Equivalence relations and classes'),
    },
    {
      // The blueprint promises an application item for this objective as well as recall.
      id: 'q_d3_a2',
      objectiveId: 'obj_relation_properties',
      type: 'worked_problem',
      role: 'application',
      difficulty: 3,
      prompt:
        'On the set {1, 2, 3} let R = {(1,1), (2,2), (1,2), (2,1)}. State which of reflexivity, ' +
        'symmetry and transitivity R has, with a reason for each.',
      answer:
        'Not reflexive: (3,3) is missing. Symmetric: the only off-diagonal pairs are (1,2) and ' +
        '(2,1), which come as a pair. Transitive: every composable pair of related elements is ' +
        'already related.',
      rubric:
        'Full marks require a verdict and a reason for all three properties. A verdict without ' +
        'a reason scores zero for that property. The reflexivity answer must name the missing pair.',
      acceptableAlternatives: [],
      evidence: sourced('chunk_5', '§5 Relations'),
      hint: 'Check reflexivity element by element before looking at the other two.',
    },
  ];
};

const SCRIPTS: Record<number, { title: string; script: string; summary: string }> = {
  1: {
    title: 'Arbitrary elements and the subset argument',
    script:
      'Today we are going to earn one sentence. The sentence is: let x be an arbitrary element ' +
      'of A. Everything you will prove about subsets rests on it. Here is why it works. When we ' +
      'say A is a subset of B, we are making a claim about every element of A at once. We cannot ' +
      'check them one at a time, so instead we pick one element, refuse to learn anything about ' +
      'it beyond the fact that it lives in A, and show it must also live in B. Because we learned ' +
      'nothing special about it, the same argument would have worked for any other element. That ' +
      'is what arbitrary means, and it is doing the work of infinitely many checks. Notice where ' +
      'this goes wrong. If halfway through the proof you say "and since x is even", you have ' +
      'stopped talking about an arbitrary element and started talking about a particular kind of ' +
      'element. The proof now covers the even ones only.',
    summary:
      'A subset proof takes an arbitrary element of the left set and derives membership of the ' +
      'right set, assuming nothing else about it.',
  },
  2: {
    title: 'Double inclusion and the distributive laws',
    script:
      'Yesterday you proved one set sits inside another. Today you will prove two sets are the ' +
      'same, and the move is simply to do yesterday twice. To show A equals B, show A is a ' +
      'subset of B, then show B is a subset of A. Each direction is its own proof with its own ' +
      'arbitrary element, and it is worth writing them as two separate paragraphs so you never ' +
      'lose track of which way you are going. Why is one direction not enough? Because a single ' +
      'inclusion is compatible with the second set being strictly larger. If you prove only that ' +
      'A sits inside B, then B might still hold something A never had. The second inclusion is ' +
      'what rules that out. When the sets involve a union, expect a case split: an element in ' +
      'B union C is in B or in C, and you handle each case, showing both land where you need.',
    summary:
      'Set equality is proved by two independent subset arguments; unions inside the statement ' +
      'usually force a case split.',
  },
  3: {
    title: 'Relations, equivalence and partitions',
    script:
      'A relation is nothing more mysterious than a set of ordered pairs. What makes relations ' +
      'useful is the properties they can have. Reflexive means every element relates to itself, ' +
      'and note that this is a claim about every element, so one missing pair destroys it. ' +
      'Symmetric and transitive are different in kind: they are conditional. They only say what ' +
      'must happen when pairs are already related. That is why the empty relation on a non-empty ' +
      'set is symmetric and transitive but not reflexive, which is a good example to keep in your ' +
      'pocket. Put all three together and you have an equivalence relation, and something ' +
      'remarkable follows. The equivalence classes partition the set: every element sits in ' +
      'exactly one class, and two classes are either identical or share nothing. Reflexivity is ' +
      'what guarantees nobody is left out. Symmetry and transitivity are what force two ' +
      'overlapping classes to collapse into one.',
    summary:
      'Reflexivity, symmetry and transitivity together produce an equivalence relation, whose ' +
      'classes partition the underlying set.',
  },
};

export const referenceLesson = (day: number): LessonPackage => {
  const content = SCRIPTS[day];
  if (!content) throw new Error(`No reference lesson fixture for day ${day}`);
  const questions = questionsForDay(day);

  return {
    schemaVersion: '1.0.0',
    day,
    title: content.title,
    objectiveIds: [...new Set(questions.map((q) => q.objectiveId))],
    script: content.script,
    transcript: content.script,
    summary: content.summary,
    examples:
      day === 3
        ? ['Remainders modulo 3 on {1,...,6} give the classes {1,4}, {2,5}, {3,6}.']
        : ['A intersect B is a subset of A.'],
    pausePrompts: [
      {
        atSecond: 45,
        prompt: 'Before I continue: say out loud what "arbitrary" is protecting you from.',
        expectedAnswer: 'Assuming a property the element need not have.',
      },
    ],
    questions,
    estimatedMinutes: day === 3 ? 14 : 12,
    evidence: sourced(`chunk_${day + 1}`, `§${day + 1}`),
  };
};

export const REFERENCE_DAY_COUNT = 3;

export const referenceVerification = (artefactId: string, day: number): VerificationReport => ({
  schemaVersion: '1.0.0',
  artefactId,
  independentSolutions: questionsForDay(day).map((q) => ({
    questionId: q.id,
    answer: q.answer,
    agrees: true,
    reasoningSummary: 'Solved independently from the prompt; reached the published answer.',
  })),
  findings: [],
});
