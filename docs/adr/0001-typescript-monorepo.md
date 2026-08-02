# ADR 0001: TypeScript end to end in a pnpm monorepo

- Status: accepted
- Date: 2026-08-02

## Context

GapOS is built largely by coding agents. The dominant cost is not CPU time; it is the cost of an
agent holding an accurate model of the system while changing it. Every language boundary adds a
serialisation contract, a second toolchain, a second test runner, and a place for an agent to
produce something that type-checks on one side and breaks on the other.

Rust was considered for the generation worker (parsing, audio, concurrency).

## Decision

Use TypeScript for the web application, the API, the worker, and all shared packages, in a single
pnpm workspace. Do not put Rust on the MVP critical path.

Rust may be introduced later, for a bottleneck that has been *measured*: document parsing, local
inference orchestration, or high-throughput audio processing. It enters behind an existing
interface, never as a rewrite.

## Consequences

- One toolchain: one lint config, one type checker, one test runner, one install command.
- Shared types between client, API and worker without a codegen step, so a contract change breaks
  the build immediately rather than at runtime.
- CPU-bound work is slower than it would be in Rust. Accepted: the MVP is latency-bound on
  provider calls, not on local computation.
- If a bottleneck appears, the fix is localised because the interfaces already exist.
