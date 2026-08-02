# Decisions log

Decisions taken during the build that are smaller than an ADR but would otherwise be invisible.
Newest first. An entry that reverses architecture belongs in `docs/adr/`, not here.

## 2026-08-02 — Repository interfaces take an owner on every call

`findById(id)` does not exist anywhere in `packages/database`. Every read and write takes an
`OwnerId` as its first argument, so a cross-tenant read is a type error rather than a review
finding. The cost is slightly noisier call sites; the benefit is that the security property is
enforced by the compiler.

## 2026-08-02 — Source resolution instead of a build step for workspace packages

Workspace packages expose `src/index.ts` directly and are consumed through tsconfig paths and
vitest aliases. There is no per-package build in the inner loop, so a change in `domain` is
visible to `worker` immediately without a watch process. Production bundling happens at the app
boundary.

## 2026-08-02 — Fakes are the default provider set

`GAPOS_PROVIDER_MODE` defaults to `fake`. A real provider must be opted into explicitly. This
means no test run and no accidental local script can spend money, and it makes the whole suite
deterministic and offline by default.

## 2026-08-02 — A green build is not evidence that nothing failed

Migration 002 exists because a passing CI run's Postgres server log contained
`duplicate key value violates unique constraint "artefacts_lesson_id_kind_version_key"`.
The suite was green: the failing insert was swallowed by the pipeline's audio fallback, which
exists for a failing provider and cannot tell that apart from a schema that rejects the write.
Every lesson shipped transcript-only on Postgres.

Two habits come out of this. Read the service logs of a green run, not only a red one. And
assert on the artefact the feature is supposed to produce — `textOnly === false` and a count of
audio segments — rather than on the status code of the operation that was supposed to produce
it, because a fallback path will happily report success.
