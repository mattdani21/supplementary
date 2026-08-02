# SECURITY

## Minimum controls

- Row-level ownership on every learner record. Every repository query takes an owner and filters
  on it; there is no "fetch by id" that skips ownership.
- Object storage private by default. No public buckets, no public objects.
- Short-lived signed URLs for audio and uploads.
- Encryption in transit and at rest.
- Secrets live outside the repository, injected as environment variables.
- File type, size and malware checks on upload.
- Prompt-injection treatment for every uploaded document.
- Strict separation between instruction and retrieved source text.
- Rate limits for uploads, generation and grading.
- Audit records for deletion, export and provider calls.
- Configurable retention and full account deletion.
- No training on private content unless the user explicitly opts in.

## AI-specific controls

**Retrieved text is evidence, never instruction.** Source text is passed to a model only inside a
delimited evidence envelope, with an explicit statement that content inside the envelope is data.
Instructions found inside source text are reported as an `AuditFinding`, not followed. This is
covered by an injection test fixture in the reference evaluation pack (fixture 7).

**Schema validation before persistence.** Every provider response passes its zod contract before
it touches the database. A response that fails validation is retried within the call's retry
policy and then recorded as a failure — never coerced, never partially saved.

**Bounded calls.** Every model call carries a timeout, a retry policy and a cost ceiling. Per-run
and per-user daily budgets are enforced by the cost accountant in `packages/observability`; when a
budget is exhausted the run degrades (text-only fallback) rather than overspending.

**Independent verification.** A generator's output is checked by a separately prompted verifier
that solves the problem itself. A verifier cannot approve output it produced.

**Sensitive domains.** Safety classification runs before publication. High-stakes topics display
limitations and source requirements, and GapOS never presents itself as a certification path for
medical, legal or safety-critical practice.

## Data handling

| Data | Storage | Retention |
| --- | --- | --- |
| Uploaded sources | private object storage, checksum-addressed | until the learner deletes the gap or retention expires |
| Extracted chunks and embeddings | Postgres, owner-scoped | with the source |
| Generated artefacts | object storage + Postgres metadata, versioned | with the curriculum |
| Attempts and mastery evidence | Postgres, owner-scoped | until account deletion |
| Provider call records | Postgres, no prompt bodies with user content beyond a hash | 90 days |

Account deletion removes learner rows, storage objects and derived indexes, and writes an audit
record. Export produces the learner's gaps, curricula, artefacts, attempts and evidence.

## What is never exposed

Provider prompts, provider credentials, model chain-of-thought, and internal reasoning are never
returned by an API or shown in the generation log. The generation log shows stage names, timings
and recoverable errors only.

## Threat notes

| Threat | Mitigation |
| --- | --- |
| Prompt injection via uploaded document | evidence envelope, injection fixtures, findings recorded not obeyed |
| Cross-tenant read | owner-scoped repositories, ownership tests in the integration suite |
| Signed URL leakage | short expiry, no URLs in logs |
| Cost exhaustion by hostile input | per-run and per-user ceilings, upload size limits, rate limits |
| Malicious upload | type allow-list, size limit, malware scan, never executed |
| Model output persisted unchecked | zod contracts enforced at the persistence boundary |
| Fluent but wrong content | source grounding, independent verification, evaluation pack |
