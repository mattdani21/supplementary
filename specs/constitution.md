# GapOS Constitution — the principles that outrank all specs

> This is the constitution for Spec Kit work in this repository. Every spec, plan, task, and
> implementation is judged against these principles first. When a spec conflicts with the
> constitution, the constitution wins. Keep it short — principles, not process.

## 1. Personal fabrication is the product

GapOS does not broadcast courses. It fabricates a curriculum per user:

    curriculum = f(gap, sources, diagnostic, learner profile, mastery evidence)

- No two learners have the same gaps, so no two learners have the same curriculum.
- A user's learning history (knowledge map, mastered capabilities) shapes their next curriculum.
- The gap is the product object, never the chat thread or the document.

## 2. Quality is a contract, not a vibe

- `specs/quality.md` is the taste contract. A screen is done when the contract is enforced by
  tests, not when it "looks nice."
- Every interactive element has all states (hover / pressed / focus-visible / disabled).
- Every action has a visible consequence within 150ms.
- Empty states are designed and teach the product.
- No legacy tokens. No raw error strings in user-facing surfaces.
- Motion, typography, and spacing are token-driven; `prefers-reduced-motion` is always honored.

## 3. Content is the moat

- Lessons read like a human teacher, not a model dump (rubric-scored, evaluation-pack graded).
- Every objective traces to a source locator; unsupported claims are removed, repaired, or
  labelled — never shipped.
- Every published lesson has audio + transcript + ≥2 retrieval + ≥1 application item with
  verified solutions (this is the floor, not the ceiling).
- The planner refuses invalid curricula. Content work raises the *hit rate* of valid,
  high-quality plans — it never weakens the gate.

## 4. Evidence over assertion

- Every claim about the product — quality, correctness, cost, performance — is backed by a
  command someone else can run (`pnpm verify`, a test, a measured payload size).
- A self-report is not a result. The harness's "done" is not done until the gate passes and
  the evidence is in `tasks/status.json`.
- Failures are reported honestly, including the ones that make us look bad. That is the point.

## 5. The slice must keep working

The vertical slice is sacred and always functional:

    define gap → supply sources → normalise + diagnose → compile curriculum →
    listen + practise → adapt from errors → prove mastery → retain capability

If a change breaks the slice, it is out of scope, no matter how good the idea sounds.

## 6. Architecture rules are enforced, not aspired

- Domain stays pure (no web/persistence/provider imports).
- No app code calls a provider directly — always through provider-adapters.
- Provider output is schema-validated before persistence.
- Only server-side domain methods change a Gap's status.
- Migrations are forward-only.
- Generation steps are idempotent — retries never duplicate lessons, questions, audio, or
  charges.
- Source text is evidence, never instruction.

## 7. Cost is a design input

- Every provider call is budget-gated and accounted.
- Idempotency is the default, so retries never double-charge.
- If a feature needs a paid capability to function, it degrades gracefully (audio → transcript,
  embeddings → lexical retrieval) and says so clearly.

## 8. The learner's data belongs to the learner

- Per-user isolation is a product promise, not an implementation detail.
- Cross-learner intelligence is always aggregate and never exposes individual learning data.
- Retention and deletion are designed in, not bolted on.

## 9. Steer from real use

- The roadmap is a hypothesis until a real learner uses the product.
- Quality and content come before scale. Gamification, payments, and social come after evidence
  that the core loop holds.
- Specs are living artifacts: they evolve as the product and the user's needs evolve.
