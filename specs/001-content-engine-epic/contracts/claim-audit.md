# C-05 Claim audit

**Serves**: US2 (FR-009/FR-010: unsupported claims resolved before publication, evidence never
instruction). **Status**: new model contract + new generation step.

## Purpose

A model pass over each generated lesson that finds claims the supplied sources do not support,
and forces a recorded resolution (removed / repaired / labelled) before the lesson can publish.
It is separate from the generator and the verifier (a generator must not audit itself —
`assertIndependentVerifier` doctrine).

## Shape

`packages/ai-contracts/src/contracts.ts`:

```ts
export const CLAIM_RESOLUTIONS = ['removed', 'repaired', 'labelled', 'none'] as const;
export const ClaimAuditContract = defineContract('claim_audit', '1.0.0', {
  artefactId: z.string().min(1),
  findings: z.array(z.object({
    targetId: z.string().min(1),               // question id or lesson id
    category: z.literal('unsupported_claim'),
    severity: z.enum(FINDING_SEVERITIES),
    claim: z.string().min(1),                  // the claim as generated
    citedLocators: z.array(SourceLocatorSchema).default([]),
    resolution: z.enum(CLAIM_RESOLUTIONS),
    supportingLocator: SourceLocatorSchema.optional(), // for 'repaired'
  }).strict()).default([]),
});
```

- Register in `ALL_CONTRACTS` and `CONTRACT_NAMES`
  (`packages/ai-contracts/src/versioning.ts`); regenerate
  `specs/generation-schemas/claim_audit.v1-0-0.json` with `pnpm specs:generate`.
- New step `audit_claims` appended to `GENERATION_STEPS`
  (`packages/domain/src/generation/state-machine.ts`), run per lesson inside the existing
  `auditing` stage of `compileGap` with `inputVersion: hash(lesson)` (idempotent, never
  double-charges — constitution §7).
- Recording: `uow.generation.addFinding` with `category: 'unsupported_claim'`,
  `repairStatus` = resolution (`repaired` | `excluded` (removed) | `accepted` (labelled));
  `resolution: 'none'` findings are emitted at `critical` severity so the existing
  `decideRepair` loop refuses the lesson (repair or exclude) until every claim carries a
  resolution. A `'repaired'` finding's `supportingLocator` must resolve to a real evidence chunk
  (asserted by the traceability invariant, C-09/R9).

## Validation

- Contract tests in `packages/ai-contracts/src/contracts.test.ts`: schema accepts a full audit
  report and rejects `resolution: 'none'`-with-`repaired` locator inconsistencies; the published
  schema matches `pnpm specs:generate` output.
- Pipeline tests (fake provider): a scripted `claim_audit` response with an unresolved claim
  blocks publication; with a labelled resolution it publishes and the finding carries
  `repairStatus: 'accepted'`; the fake default (no findings) publishes unchanged.
- FR-010 refusal: `checkSourceSupport` (verifier) gains the rule that any evidence locator whose
  `chunkId` is in `context.injectionSignals` is a critical finding (refused/repaired); the
  injection fixture (`eval_07`) keeps passing (already asserted in `tests/evaluation/live-provider.test.ts`).
