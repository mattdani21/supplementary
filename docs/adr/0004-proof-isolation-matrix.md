# ADR 0004 — Notebook proof isolation acceptance matrix

Status: Accepted as a **requirement matrix**. A sandbox architecture is **not** selected.

Date: 2026-09-13

## Context

Arc notebook proofs currently execute in a fresh `node:vm` realm inside the application
process (`apps/worker/src/notebook/executor.ts`). Script time and output size are bounded.
That is acceptable for explicit local development. It is not a public isolation guarantee.

GAPX-03 ships a disable-by-default capability flag. This ADR records the acceptance matrix
for a later isolated executor. It does **not** approve a vendor or architecture change.

## Decision

Public/shared mode defaults to `GAPOS_PROOF_EXECUTION=disabled`. An invited private instance
may set `local` explicitly. Implementation of an isolated backend stays `not_run` until a
human architecture review selects a deployment-supported boundary.

## Isolation acceptance matrix

| Property | Required | Current `node:vm` | Isolated backend |
| --- | --- | --- | --- |
| Independent process or container | Yes for public | No | not_run |
| No host secrets in the guest | Yes | Best-effort (no `process`/`require`) | not_run |
| No network | Yes | Not proven | not_run |
| No writable host mounts | Yes | Same process filesystem | not_run |
| Bounded CPU and wall time | Yes | Wall timeout present | not_run |
| Bounded memory and output | Partial today | Output length capped | not_run |
| Termination on timeout | Yes | Present | not_run |
| Cleanup after failure | Yes | Realm discarded | not_run |
| Concurrent job isolation | Yes | Shared process | not_run |
| Nontermination fixture | Required | Covered locally | not_run |
| Allocation exhaustion fixture | Required | not_run | not_run |
| Host access attempt fixture | Required | Partial (`require`/`process`) | not_run |

## Consequences

- Disabled proof-run requests return `503` / `proof_execution_unavailable` and invoke no executor.
- Saved lessons remain readable.
- Do not mark GAPX-03 sandbox implementation complete until the isolated-backend column is tested.
