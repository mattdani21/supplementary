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
          estimatedMinutes: 5,
        },
        { kind: 'retrieval', description: 'Recall the subset definition', estimatedMinutes: 12 },
        { kind: 'application', description: 'Prove a subset claim', estimatedMinutes: 18 },
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
          estimatedMinutes: 5,
        },
        { kind: 'application', description: 'Prove one distributive law', estimatedMinutes: 25 },
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
          estimatedMinutes: 5,
        },
        { kind: 'application', description: 'Prove an equivalence relation', estimatedMinutes: 25 },
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

/**
 * The spoken scripts.
 *
 * Written to be *heard*: no bullets, no headings, no "as shown below", and no sentence that only
 * works on a page. Each runs about five minutes at 150 words per minute, which is what the plan
 * budgets — a script that claims twelve minutes and runs one is the exact defect the evaluation
 * pack's duration dimension exists to catch.
 */
const SCRIPTS: Record<number, { title: string; script: string; summary: string }> = {
  1: {
    title: 'Arbitrary elements and the subset argument',
    script:
      'Today we are going to earn one sentence. The sentence is: let x be an arbitrary element ' +
      'of A. It looks like throat-clearing. It is not. Almost everything you will ever prove ' +
      'about subsets rests on that sentence, and if you understand why it works you will stop ' +
      'writing proofs that feel like guesswork. So let us slow down and take it apart. ' +
      'When we say that A is a subset of B, we are making a claim about every single element of ' +
      'A at once. If A has five elements we could, in principle, check them one at a time. But ' +
      'most of the sets you care about are infinite, and even the finite ones are usually ' +
      'described by a property rather than a list. So checking one at a time is not available ' +
      'to us. We need an argument that covers all of them in one go. ' +
      'Here is the trick, and it is one of the most reliable moves in mathematics. We pick a ' +
      'single element. We then refuse, deliberately and completely, to learn anything about it ' +
      'beyond the one fact that it lives in A. And from that single fact we show it must also ' +
      'live in B. Now here is the part that does the work. Because we never used anything ' +
      'special about the element we picked, the very same argument would have gone through for ' +
      'any other element of A. We did not check them all. We showed that checking any one of ' +
      'them would go the same way. That is what the word arbitrary is carrying, and it is ' +
      'standing in for infinitely many checks. ' +
      'Let me show you where this goes wrong, because the failure is instructive. Suppose you ' +
      'are proving something about a set of numbers, and halfway through you write: and since x ' +
      'is even, we can write x as two k. Stop. You have just stopped talking about an arbitrary ' +
      'element and started talking about a particular kind of element. Your proof is now a ' +
      'proof about the even members of A. If A also contains odd numbers, you have proved ' +
      'nothing about them. The proof looks complete. It reads fluently. It is wrong, and it is ' +
      'wrong in a way that is very easy to miss when you are reading your own work. ' +
      'So when you write a subset proof, hold yourself to a simple discipline. After every line ' +
      'ask: did I just assume something about x that I was not given? If the answer is yes, you ' +
      'have either made an error, or you have discovered that your claim needs a case split, ' +
      'where you handle the even ones and the odd ones separately and both cases land in B. ' +
      'A case split is perfectly respectable. Quietly assuming one case is not. ' +
      'One more thing about shape. A subset proof has a standard skeleton, and I want you to be ' +
      'able to write the skeleton before you know how to fill it in. It goes like this. Let x ' +
      'be an arbitrary element of the left-hand set. Then, by the definition of that set, ' +
      'something is true about x. From that, by some reasoning, something else is true about x. ' +
      'Therefore x belongs to the right-hand set. Since x was arbitrary, every element of the ' +
      'left-hand set belongs to the right-hand set, which is what we wanted. ' +
      'Notice that the first line and the last line are always the same. They cost you nothing ' +
      'to write and they tell your reader exactly what kind of argument is coming. Write them ' +
      'first, before you have any idea how the middle goes. Very often the middle becomes ' +
      'obvious once the two ends are pinned down, because you can see precisely what you have ' +
      'and precisely what you need. ' +
      'In your practice today you will prove that A intersect B is a subset of A. It is a short ' +
      'proof and you may find it almost too easy. Do it anyway, and write the skeleton out in ' +
      'full. The habit is the point, not the difficulty. Tomorrow you will need the same move ' +
      'twice in a row, and the day after that you will need it inside a much harder argument ' +
      'about equivalence classes. If the skeleton is automatic by then, all your attention will ' +
      'be free for the part that is actually hard.',
    summary:
      'A subset proof takes an arbitrary element of the left set and derives membership of the ' +
      'right set, assuming nothing else about it. The word arbitrary is what turns one check ' +
      'into infinitely many.',
  },
  2: {
    title: 'Double inclusion and the distributive laws',
    script:
      'Yesterday you proved that one set sits inside another. Today you are going to prove that ' +
      'two sets are exactly the same, and the good news is that the move is simply to do ' +
      'yesterday twice. To show that A equals B, you show that A is a subset of B, and then you ' +
      'show that B is a subset of A. That is the whole method. It is called proof by double ' +
      'inclusion, and it is the standard way set identities are established. ' +
      'Let me say a word about why two directions are needed, because this is where people ' +
      'convince themselves they are finished when they are not. Suppose you have proved only ' +
      'that A sits inside B. What have you ruled out? You have ruled out A containing anything ' +
      'that B does not. What have you not ruled out? You have not ruled out B containing ' +
      'something that A does not. A could be a strict subset, a genuinely smaller collection ' +
      'sitting inside a larger one, and everything you proved would still hold. The second ' +
      'inclusion is exactly what closes that gap. One direction gives you at most. Two ' +
      'directions give you equality. ' +
      'In practice I want you to write the two directions as two clearly separate paragraphs, ' +
      'each starting with its own arbitrary element. There is a reason for this beyond ' +
      'tidiness. When the two arguments are tangled together on the page it becomes very easy ' +
      'to use a fact you established in the first direction while you are working in the ' +
      'second, and that fact may not be available to you there. Keeping them apart makes the ' +
      'mistake visible. Some people even label them: first, the forward inclusion. Second, the ' +
      'reverse inclusion. Do that if it helps. ' +
      'Now let us talk about what happens when a union shows up inside the statement, because ' +
      'that is where today gets interesting. Consider the claim that A intersect the union of B ' +
      'and C equals the union of A intersect B and A intersect C. This is one of the ' +
      'distributive laws, and it is the standard exercise for double inclusion. ' +
      'Take the forward direction. Let x be an arbitrary element of A intersect the union of B ' +
      'and C. Unpacking the intersection, x is in A, and x is in the union of B and C. Now ' +
      'unpack that union. It tells you x is in B, or x is in C. Notice that word: or. You do ' +
      'not know which. You cannot pick one. What you can do is handle both possibilities, and ' +
      'that is a case split. In the first case, x is in B, and since x is also in A, x lies in ' +
      'A intersect B, so it lies in the union we are aiming for. In the second case, x is in C, ' +
      'and by exactly the same reasoning it lies in A intersect C, so again it lies in the ' +
      'union. Either way we land where we need to be. That is the forward direction finished. ' +
      'The reverse direction is a little easier, and it is worth noticing why. Let x be an ' +
      'arbitrary element of the union of A intersect B and A intersect C. Again this is an or, ' +
      'so again we split. In both cases x is in A, which is half of what we want. And in the ' +
      'first case x is in B, in the second x is in C, so in both cases x lies in the union of B ' +
      'and C, which is the other half. So x is in A and in the union of B and C, which is ' +
      'exactly membership of the left-hand set. Both inclusions hold, so the sets are equal. ' +
      'Here is the pattern to carry away. An intersection in your hypothesis is a gift: it ' +
      'gives you two facts for free. A union in your hypothesis is a demand: it forces a case ' +
      'split, because you learn only that one of two things holds. When you are stuck in a set ' +
      'proof, it is very often because you have been handed a union and have not yet split on ' +
      'it. Look for the or. ' +
      'Your practice today is the other distributive law, the one with union on the outside. ' +
      'Write both directions, keep them in separate paragraphs, start each with an arbitrary ' +
      'element, and split whenever you meet a union. If you find yourself writing a sentence ' +
      'that begins with therefore and you cannot say which earlier line it follows from, go ' +
      'back. That feeling is almost always a skipped case.',
    summary:
      'Set equality is proved by two independent subset arguments, one in each direction. A ' +
      'union in the hypothesis forces a case split; an intersection hands you two facts.',
  },
  3: {
    title: 'Relations, equivalence and partitions',
    script:
      'A relation is nothing more mysterious than a set of ordered pairs. That is the whole ' +
      'definition. A relation on a set A is a subset of A cross A, and when we write a R b we ' +
      'are just saying that the pair a b is in that subset. If that feels anticlimactic, good. ' +
      'The definition is not where the content is. The content is in the properties a relation ' +
      'can have, and in what those properties buy you. ' +
      'There are three we care about today. Reflexive means every element relates to itself: ' +
      'for every a in A, a relates to a. Symmetric means that whenever a relates to b, b also ' +
      'relates to a. Transitive means that whenever a relates to b and b relates to c, a ' +
      'relates to c. ' +
      'Now I want you to notice a difference in kind between these, because it explains most of ' +
      'the mistakes people make. Reflexivity is an unconditional claim about every element. It ' +
      'says something must be present, for all of them, no exceptions. That means a relation ' +
      'can fail to be reflexive because of a single missing pair. One element left out and the ' +
      'property is gone. ' +
      'Symmetry and transitivity are not like that. They are conditional. They say what must ' +
      'happen when elements are already related, and they say nothing whatsoever about pairs ' +
      'that are not related. This has a consequence that catches people out every time, so keep ' +
      'it in your pocket. Take the empty relation on a non-empty set: no element relates to ' +
      'anything at all. Is it symmetric? Yes, vacuously, because there is no case where a ' +
      'relates to b for the condition to fail on. Is it transitive? Yes, for the same reason. ' +
      'Is it reflexive? No, and badly so, because reflexivity demanded a pair for every element ' +
      'and we supplied none. So symmetry and transitivity do not give you reflexivity, and any ' +
      'argument that claims otherwise has a hole in it. ' +
      'Put all three together and you have an equivalence relation, and now something genuinely ' +
      'remarkable happens. Define the equivalence class of an element a to be the set of all ' +
      'elements related to a. The theorem is that these classes partition the set: every ' +
      'element lies in exactly one class, and two classes are either identical or share nothing ' +
      'at all. There is no partial overlap. Ever. ' +
      'I want you to see which property does which job in that proof, because this is the part ' +
      'worth understanding rather than memorising. Reflexivity is what guarantees nobody is ' +
      'left out: since a relates to itself, a is in its own class, so every element is in some ' +
      'class and the classes cover the whole set. Symmetry and transitivity together are what ' +
      'force overlapping classes to collapse into one. Suppose some element x lies in both the ' +
      'class of a and the class of b. Then x relates to a and x relates to b. By symmetry, a ' +
      'relates to x. By transitivity, a relates to b. And from there, a short argument shows ' +
      'every member of one class is a member of the other, in both directions, which by double ' +
      'inclusion means the classes are equal. Notice that you just used yesterday. ' +
      'So the shape of the result is: reflexivity gives coverage, symmetry and transitivity ' +
      'give disjointness, and together they give a partition. If you can say that sentence and ' +
      'mean it, you understand equivalence relations. ' +
      'Let me give you a concrete one to hold on to. Take the numbers one through six, and ' +
      'relate two numbers when they leave the same remainder on division by three. Reflexive: ' +
      'every number has the same remainder as itself. Symmetric: sameness of remainder does not ' +
      'care about order. Transitive: if two numbers match a third, they match each other. So it ' +
      'is an equivalence relation, and the classes are one and four, two and five, three and ' +
      'six. Three classes, none empty, none overlapping, covering everything. That is a ' +
      'partition, and you can see it directly. ' +
      'Your practice today has two parts. First, take a small explicit relation and decide ' +
      'which of the three properties it has, giving a reason for each, and naming the missing ' +
      'pair when reflexivity fails. Second, a transfer problem: the integers, related when ' +
      'their difference is divisible by five. Prove it is an equivalence relation and describe ' +
      'the classes. That second one is unfamiliar territory, which is the point. If you can do ' +
      'it, you are not pattern-matching on examples you have seen. You are using the ' +
      'definitions.',
    summary:
      'Reflexivity, symmetry and transitivity together make an equivalence relation, whose ' +
      'classes partition the set. Reflexivity supplies coverage; symmetry and transitivity ' +
      'supply disjointness.',
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
    estimatedMinutes: 5,
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
