# ADR 0003: The AI provider boundary

- Status: accepted
- Date: 2026-08-02

## Context

The product's quality risk is not that a model is unavailable — it is that a model returns fluent,
plausible, wrong content, and that the wrong content is persisted and taught. A secondary risk is
that provider-specific calls spread through the codebase and make evaluation, cost control and
substitution impossible.

## Decision

All model access goes through `packages/provider-adapters`, which exposes three interfaces:
`LanguageModel`, `SpeechToText`, `TextToSpeech`. Application and worker code may not import a
provider SDK; lint enforces this.

Every structured call is a **contract**: a named, versioned zod schema in
`packages/ai-contracts` describing the response. The adapter validates the response against the
contract before returning it. Persistence accepts only validated contract objects.

The default provider set is a deterministic **fake** (`GAPOS_PROVIDER_MODE=fake`). Tests run
against the fakes; the fakes include deliberately faulty responses so the verifier and repair loop
are exercised without spending money or depending on a network.

Prompts separate instruction from evidence. Retrieved source text is passed inside a delimited
evidence envelope and is treated as data.

## Consequences

- Providers are swappable by configuration, and provider routing (E17) becomes a policy change
  rather than a refactor.
- The evaluation harness can replay recorded contract fixtures deterministically.
- Every model response is schema-checked, so a malformed response fails loudly at the boundary
  instead of quietly corrupting a curriculum.
- Contracts must be versioned and migrated deliberately; a schema change is a visible event with a
  version bump, which is the point.
- A little ceremony per call. Accepted: it is the cheapest place in the system to be strict.
