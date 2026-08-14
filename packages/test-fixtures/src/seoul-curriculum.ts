/**
 * Matt's three real learning tracks (E21 / GAP-032), as seedable fixtures.
 *
 * The seed script (scripts/seed-curriculum.ts) turns these into gaps through the CLI service
 * layer, and the repository test asserts the seeded state. The content is genuine material from
 * ~/Seoul-plan/SKILLS-CURRICULUM.md (math + frontier-papers tracks) and ~/Seoul-plan/
 * TOPIK-TRACKER.md (Korean track), plus real URLs — arXiv paper IDs, MIT OCW 18.06, 3Blue1Brown
 * playlists, TTMIK and topik.go.kr — so the pipeline ingests the actual curriculum Matt is
 * following, not lorem ipsum.
 *
 * Like the set-theory primer, every source document is deliberately structured with headings:
 * chunk locators ("§ <heading>") are what ingestion must preserve, and a source with no
 * headings degrades to a single "Document" locator.
 */

export interface SeedSource {
  readonly filename: string;
  readonly mediaType: 'text/markdown';
  readonly text: string;
}

export interface SeedTrack {
  /** Deterministic id, so re-running the seed can find the gap and never duplicate it. */
  readonly gapId: string;
  readonly title: string;
  readonly rawStatement: string;
  readonly targetCapability: string;
  readonly dailyMinutes: number;
  readonly sources: readonly SeedSource[];
}

/* ------------------------------------------------------------ math -> ML fluency */

const MATH_TRACK_SOURCE = `# Skills & Math Curriculum — Track B: Math to ML fluency

## Honest baselines (read once)

Reading is not publishing. Path to first publishable result: replicate → blog → preprint → workshop. Realistic: 6–9 months to a first arXiv preprint (replication-grade), 12–24 months to an original method paper, 24+ for SNN. DeepSeek papers are readable with this curriculum: V2/V3/R1 use standard transformer math plus well-documented engineering, and the prerequisites — linear algebra (tensor shapes, SVD), matrix calculus, probability, optimization — are exactly this track.

## Phase 1 (Wks 1–8) Linear algebra fluency

- 3Blue1Brown *Essence of Linear Algebra* (16 videos) — intuition layer
- MIT OCW 18.06 (Strang) lectures 1–20 + selected problem sets — fluency layer
- Deliverable: SVD + eigendecomposition by hand; matrix calculus (gradients of quadratic forms)

## Phase 2 (Wks 9–16) Calculus + optimization

- 3Blue1Brown *Essence of Calculus* (12 videos); Paul's Online Math Notes for drills
- MML book (Deisenroth) ch. 5–7: vector calculus, optimization, backprop
- Deliverable: derive backprop for a 2-layer net from scratch in numpy, no autograd

## Phase 3 (Wks 17–28) Probability + information theory (skip actuarial basics, go deep)

- Shannon entropy, cross-entropy, KL divergence, MLE/MAP, Bayesian inference
- Distillation math (Hinton 2015 objective = KL), perplexity, cross-entropy loss
- Books: MacKay *Information Theory, Inference and Learning Algorithms* (free PDF, ch. 1–6) — also covers coding/point-process ideas wanted for SNNs; Bishop ch. 1–2

## Ongoing spine

*Mathematics for Machine Learning* (free PDF, mml-book.github.io) — 1 chapter per 2 weeks, problems solved, not videos watched.

## Weekly time budget (honest capacity check)

| Slot | Time |
|---|---|
| Math | 30–40 min/day |
| Papers + replication notes | 2–3 hrs/wk |
| Total | ≈ 2 hrs/day |

Study hours are the flexible buffer during Seoul deadline sprints and client work, not the other way around.`;

const MATH_RESOURCES_SOURCE = `# Math resources — MIT OCW 18.06, 3Blue1Brown, MML

## MIT OCW 18.06 Linear Algebra (Strang) — fluency layer

Course page: https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/
Watch lectures 1–20 and work the selected problem sets. Deliverable: SVD + eigendecomposition by hand; matrix calculus (gradients of quadratic forms).

## 3Blue1Brown — Essence of Linear Algebra (16 videos) — intuition layer

Playlist: https://www.youtube.com/playlist?list=PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab
Vectors, linear combinations, span, matrices as linear transformations, determinant, dot and cross products, change of basis, eigenvectors and eigenvalues, abstract vector spaces.

## 3Blue1Brown — Essence of Calculus (12 videos)

Playlist: https://www.youtube.com/playlist?list=PLZHQObOWTQDMsr9K-rj53DwVRMYO3t5Yr
The derivative, chain rule, integrals, Taylor series, limits — the geometry of calculus needed to read gradient-based ML papers.

## Mathematics for Machine Learning (Deisenroth, Faisal, Ong) — ongoing spine

Book + free PDF: https://mml-book.github.io/
One chapter per 2 weeks with problems solved, not videos watched. Chapters 5–7: vector calculus, optimization, backpropagation.

## Information Theory, Inference, and Learning Algorithms (MacKay)

Free PDF: https://www.inference.org.uk/itila/
Chapters 1–6: entropy, source coding, inference — also covers coding and point-process ideas wanted for SNN work.`;

/* ---------------------------------------------------------- frontier ML papers */

const PAPERS_LADDER_SOURCE = `# Skills & Math Curriculum — Track C: Papers ladder

## The ladder rule

1 paper/week ≈ 2–3 hrs. Every paper produces one replication note and feeds the one-post-per-week publishing cadence.

## Level 0 (Wks 1–4) Foundations

- Vaswani et al. 2017 *Attention Is All You Need* (arXiv:1706.03762) — implement attention in numpy, reproduce the shape math

## Level 1 (Wks 5–12) Transformer evolution

- RoPE (arXiv:2104.09864) · GQA (arXiv:2305.13245) · FlashAttention (arXiv:2205.14135) · PagedAttention/vLLM (arXiv:2309.06180) · LoRA (arXiv:2106.09685)

## Level 2 (Wks 13–20) DeepSeek + frontier

- DeepSeek-V2 (arXiv:2405.04434) — MLA: the LBCA comparison paper, read first · V3 (arXiv:2412.19437) — MoE + FP8 · R1 (arXiv:2501.12948) — RL reasoning · Llama 2/3 (arXiv:2307.09288 / 2407.21783) · Mistral 7B (arXiv:2310.06825)

## Level 3 (Wks 21–28) Efficiency & model surgery — the paper zone

- GPTQ (arXiv:2210.17323) · AWQ (arXiv:2306.00978) · LLM.int8 (arXiv:2208.07339) · Speculative decoding (arXiv:2211.17192) · Hinton distillation (arXiv:1503.02531) · Task arithmetic / model merging (arXiv:2212.04089) · H2O KV eviction (arXiv:2306.14048) + SnapKV (arXiv:2404.14469) — closest to LBCA, read for positioning

## Level 4 (ongoing) Neuromorphic / SNN

- LIF neuron model (RC-circuit ODE — Phase 2 calculus pays for this) · Surrogate gradients: Neftci 2019 (arXiv:1901.09948), SLAYER (arXiv:1810.03245) · STDP · Spikformer (arXiv:2204.04780) · Hardware: Intel Loihi, IBM TrueNorth ecosystem · Benchmarks: N-MNIST, DVS

## Publishing pipeline (build-in-public)

Every paper read → research notes markdown (what/why/how/replicate-it); a blog post every 1–2 weeks off the notes. Paper #1 (months 4–9): "Memory-efficient model swapping for low-resource devices" — LBCA + ModelSwapper + MLA comparison, arXiv preprint → workshop submission. SNN path: 1 survey note/quarter → Spikformer replication on a small event dataset → collaboration with KAIST/SNU/ETRI neuromorphic groups once in Korea.`;

const ARXIV_LADDER_SOURCE = `# Frontier papers — arXiv reading ladder

## Level 0 — Foundations

Attention Is All You Need — arXiv:1706.03762 — https://arxiv.org/abs/1706.03762
Implement attention in numpy and reproduce the shape math before moving on.

## Level 1 — Transformer evolution

RoPE (Rotary Position Embedding) — arXiv:2104.09864 — https://arxiv.org/abs/2104.09864
GQA (Grouped-Query Attention) — arXiv:2305.13245 — https://arxiv.org/abs/2305.13245
FlashAttention — arXiv:2205.14135 — https://arxiv.org/abs/2205.14135
PagedAttention / vLLM — arXiv:2309.06180 — https://arxiv.org/abs/2309.06180
LoRA — arXiv:2106.09685 — https://arxiv.org/abs/2106.09685

## Level 2 — DeepSeek + frontier

DeepSeek-V2 — arXiv:2405.04434 — https://arxiv.org/abs/2405.04434 (MLA; the LBCA comparison paper — read first)
DeepSeek-V3 — arXiv:2412.19437 — https://arxiv.org/abs/2412.19437 (MoE + FP8)
DeepSeek-R1 — arXiv:2501.12948 — https://arxiv.org/abs/2501.12948 (RL reasoning)
Llama 2 — arXiv:2307.09288 — https://arxiv.org/abs/2307.09288
Llama 3 — arXiv:2407.21783 — https://arxiv.org/abs/2407.21783
Mistral 7B — arXiv:2310.06825 — https://arxiv.org/abs/2310.06825

## Level 3 — Efficiency and model surgery

GPTQ — arXiv:2210.17323 — https://arxiv.org/abs/2210.17323
AWQ — arXiv:2306.00978 — https://arxiv.org/abs/2306.00978
LLM.int8 — arXiv:2208.07339 — https://arxiv.org/abs/2208.07339
Speculative decoding — arXiv:2211.17192 — https://arxiv.org/abs/2211.17192
Hinton distillation — arXiv:1503.02531 — https://arxiv.org/abs/1503.02531
H2O KV eviction — arXiv:2306.14048 — https://arxiv.org/abs/2306.14048
SnapKV — arXiv:2404.14469 — https://arxiv.org/abs/2404.14469

## Level 4 — Neuromorphic / SNN

Neftci 2019 surrogate gradients — arXiv:1901.09948 — https://arxiv.org/abs/1901.09948
SLAYER — arXiv:1810.03245 — https://arxiv.org/abs/1810.03245
Spikformer — arXiv:2204.04780 — https://arxiv.org/abs/2204.04780`;

const DEEPSEEK_SOURCE = `# DeepSeek papers — read first

## DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model (arXiv:2405.04434)

Paper: https://arxiv.org/abs/2405.04434
Introduces MLA (multi-head latent attention), the closest published relative to the LBCA KV-cache retrofit (−45–49% memory). The comparison with LBCA is itself a paper. Read first.

## DeepSeek-V3 Technical Report (arXiv:2412.19437)

Paper: https://arxiv.org/abs/2412.19437
MoE + FP8 training at scale. Standard transformer math plus well-documented engineering; readable with the Track B prerequisites.

## DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning (arXiv:2501.12948)

Paper: https://arxiv.org/abs/2501.12948
RL reasoning: R1-Zero → R1, the cold-start and RLHF stages. Replication-grade notes feed the one-post-per-week cadence.`;

/* ------------------------------------------------------------- TOPIK Korean */

const TOPIK_TRACKER_SOURCE = `# TOPIK Tracker — Study Plan & Progress (target: TOPIK II, ~Apr 2027 sitting)

45–60 min/day. Floor: TOPIK 2. Stretch: TOPIK 3 (TOPIK 3+ feeds F-2-R visa points and opens Korean-first employers). Test dates: TOPIK sits ~4x/yr (typically Jan/Apr/Jul/Oct; Korea + overseas centers). 2027 schedule published late 2026 — check topik.go.kr + nearest SA center then. Partner's daily KakaoTalk voice = free native tutor; use it.

## Daily routine (45–60 min)

| Slot | Time | Activity | Tool |
|---|---|---|---|
| Vocab | 20 min | Anki flashcards (TOPIK 1→2 core) | Anki + Evita/TOPIK decks |
| Grammar/lesson | 20 min | One structured lesson | TTMIK (Level 1→3) or Sejong Institute online (free) |
| Listening | 10–15 min | Podcasts/K-content w/ Korean subs | TTMIK Iyagi, K-dramas, YouTube |
| Speaking | 10 min | Voice chat with partner (KakaoTalk) | native tutor |

## Phase 1 — Foundation (Wks 1–8, Aug–Sep 2026)

- Week 1: Hangul read/write in 3–4 days (TTMIK Hangeul Master or Sejong app); never romanize after
- Weeks 2–8: TTMIK Level 1–2 / Sejong 1–2; TOPIK-1 core vocab (~800 words); particles, -아/어요, past/future
- By week 8: introduce yourself, simple daily-life Korean, read simple signs — TOPIK I listening comfortable
- Checkpoint: partner can hold a 5-min casual conversation with you

## Phase 2 — Solidify (Wks 9–16, Oct–Nov 2026)

- TTMIK Level 2–3; vocab →1,200–1,500; TOPIK I past papers (free at topik.go.kr)
- Start reading Korean news headlines + insurance-adjacent Korean content (domain vocab!)
- K-content with Korean subs only (no English subs)
- Checkpoint: full casual conversations with partner; TOPIK I mock ≥ 70%

## Phase 3 — TOPIK II push (Wks 17–28, Dec 2026–Mar 2027)

- Daily: one past-paper section (listening OR reading); vocab →2,000+ (TOPIK II core)
- Korean Grammar in Use (Intermediate) — one unit/day
- Weekly: 1 full timed past paper + error log (review every mistake)
- Sit TOPIK II at ~Apr 2027 sitting (register when 2027 dates drop)
- Target: 140+ per section (TOPIK 2) / 170+ (TOPIK 3 stretch)

## Progress log

| Week | Vocab count | TTMIK level | Mock score | Notes |
|---|---|---|---|---|
| 1 | 0 | 0 | — | Start |
| 8 | ~800 | 2 | | |
| 16 | ~1500 | 3 | | |
| 28 | ~2000+ | 4 | | TOPIK II sitting |

## Resources (cost < $50 total)

- TTMIK (talktomeinkorean.com) — free podcast/YouTube lessons; paid books optional
- Sejong Institute online (sejonghakdang.org) — free structured courses
- Anki — free; TOPIK decks on AnkiWeb
- Korean Grammar in Use Intermediate (~$25)
- TOPIK past papers — free official PDFs at topik.go.kr
- Papago (free) — daily lookup; never translate whole sentences you should learn
- 1345 / partner for real-world practice

## Why this matters for the plan

- E-7 jobs at Korean-first employers (insurers, chaebols) become realistic at TOPIK 2+
- TOPIK 3+ = points toward F-2-R (employer-independent residence — the ventures unlock)
- TOPIK 4+ by year 2 = full Korean workplace viability`;

const TOPIK_RESOURCES_SOURCE = `# TOPIK resources — TTMIK, topik.go.kr, Sejong

## TTMIK — talktomeinkorean.com

https://talktomeinkorean.com/
Free podcast/YouTube lessons; Levels 1–3 cover the grammar spine of the plan. TTMIK Iyagi is the listening slot. Paid books optional. Hangeul Master covers the week-1 Hangul sprint.

## TOPIK official — topik.go.kr

https://www.topik.go.kr/
Official test dates (TOPIK sits ~4x/yr), registration, and free past papers (TOPIK I and II) for the weekly timed paper and error log.

## Sejong Institute online — sejonghakdang.org

https://www.sejonghakdang.org/
Free structured courses mirroring TTMIK Levels 1–2; an alternative grammar/lesson slot.

## Korean Grammar in Use (Intermediate)

One unit/day in Phase 3; the intermediate grammar needed for the TOPIK II reading and writing sections.

## Anki + Papago

Anki (free) with TOPIK 1→2 core decks for the 20-minute vocab slot; Papago (free) for daily lookup — never translate whole sentences you should learn.`;

/* -------------------------------------------------------------------- the tracks */

export const SEED_TRACKS: readonly SeedTrack[] = [
  {
    gapId: 'gap_math_to_ml',
    title: 'Math foundations to ML fluency',
    rawStatement:
      'I want math fluency to read frontier ML papers cold — linear algebra, calculus and ' +
      'optimization, and probability — working toward deep learning and neural network research.',
    targetCapability:
      'Read frontier ML papers cold: linear algebra (tensor shapes, SVD, eigendecomposition), ' +
      'matrix calculus and backpropagation, and probability/information theory (KL divergence, ' +
      'MLE, cross-entropy), sufficient to derive attention math and read DeepSeek V2/V3/R1.',
    dailyMinutes: 40,
    sources: [
      {
        filename: 'skills-curriculum-track-b.md',
        mediaType: 'text/markdown',
        text: MATH_TRACK_SOURCE,
      },
      {
        filename: 'math-resources-mit-ocw-3b1b-mml.md',
        mediaType: 'text/markdown',
        text: MATH_RESOURCES_SOURCE,
      },
    ],
  },
  {
    gapId: 'gap_frontier_papers',
    title: 'Frontier ML papers — DeepSeek and the transformer evolution ladder',
    rawStatement:
      'I want to read frontier ML papers cold — the transformer evolution ladder and DeepSeek ' +
      'V2/V3/R1 — and write one replication note per paper toward a first arXiv preprint.',
    targetCapability:
      'Read frontier ML papers cold: implement attention from Attention Is All You Need, trace ' +
      'transformer evolution (RoPE, GQA, FlashAttention, LoRA), and explain DeepSeek V2 (MLA), ' +
      'V3 (MoE + FP8) and R1 (RL reasoning), writing a replication note per paper.',
    dailyMinutes: 30,
    sources: [
      {
        filename: 'skills-curriculum-track-c.md',
        mediaType: 'text/markdown',
        text: PAPERS_LADDER_SOURCE,
      },
      {
        filename: 'frontier-papers-arxiv-ladder.md',
        mediaType: 'text/markdown',
        text: ARXIV_LADDER_SOURCE,
      },
      {
        filename: 'deepseek-papers-read-first.md',
        mediaType: 'text/markdown',
        text: DEEPSEEK_SOURCE,
      },
    ],
  },
  {
    gapId: 'gap_topik_korean',
    title: 'TOPIK Korean — TOPIK II by April 2027',
    rawStatement:
      'I want TOPIK II fluency by the ~Apr 2027 sitting — daily reading, listening and speaking ' +
      'of Korean, with the partner as a native tutor.',
    targetCapability:
      'Pass TOPIK II (stretch TOPIK 3): ~2,000+ vocabulary, TTMIK levels 1–3 with Korean Grammar ' +
      'in Use, one full timed past paper per week with an error log, and full casual daily ' +
      'conversation.',
    dailyMinutes: 50,
    sources: [
      { filename: 'topik-tracker.md', mediaType: 'text/markdown', text: TOPIK_TRACKER_SOURCE },
      {
        filename: 'topik-resources-ttmik-topik-go-kr.md',
        mediaType: 'text/markdown',
        text: TOPIK_RESOURCES_SOURCE,
      },
    ],
  },
];

/** The deterministic gap ids, asserted by the repository test. */
export const SEED_GAP_IDS: readonly string[] = SEED_TRACKS.map((track) => track.gapId);
