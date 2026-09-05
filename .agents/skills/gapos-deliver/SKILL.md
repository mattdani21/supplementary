---
name: gapos-deliver
description: Implement a bounded supplementary work packet using its source map, contracts and acceptance criteria. Use for delivery in this repository.
---

# Deliver one GapOS / Arc packet

Read root instructions and `docs/execution/README.md`, then load only the selected packet in `docs/execution/WORK_PACKETS.md` and its contract in `TECHNICAL_SPEC.md`. Resolve paths from the repository root, not this skill directory.

Use `docs/execution/CONTEXT.md` for the actual entry points and known gaps. Recheck the source SHA and packet dependencies against the current checkout. Preserve the domain/provider boundaries and generated specs. Use the native task ledger when execution begins; recheck overlapping learner-journey PRs before reserving files.

Restate the numbered acceptance criteria and reserve the named files before edits. Use the fixtures and commands in the packet. Preserve the existing public contract unless the packet explicitly specifies its migration. Do not repair adjacent issues or edit a historical result to make an outcome look successful.

Hand the verifier the resulting commit, diff and reproduction commands using the execution-package handoff record. Keep the task incomplete until the required tests and review are recorded. If a dependency is unavailable, finish the bounded local preparation and record the missing gate precisely.
