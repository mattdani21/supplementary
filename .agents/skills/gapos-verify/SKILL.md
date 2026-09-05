---
name: gapos-verify
description: Independently verify a supplementary work packet against its technical contract and failure cases. Use when reviewing an implementation in this repository.
---

# Verify one GapOS / Arc packet

Read root instructions, `docs/execution/README.md`, the selected work packet and `TECHNICAL_SPEC.md` before reading the implementer's explanation. Resolve all paths from the repository root.

Record the exact commit under review. Derive at least one success case and the named refusal/failure cases from the contract. Test separate web/worker contexts against Postgres, two-owner spoofing, and zero side effects after refusal. Report skipped database or live-provider tests separately from fake-backed passes.

Use the packet's test commands and the context file's environment prerequisites. Separate source inspection, fake-backed tests and live evidence. Inspect shared-state, error and rollback behavior within the packet's scope. Check that no source fixture, oracle, budget or threshold was weakened to obtain a pass.

Return the handoff record with an outcome for every acceptance criterion and a verdict of `pass`, `changes_requested` or `blocked`. Missing hardware, dependencies or services are explicit `not_run` entries. A preparation-only pass cannot close an execution or launch gate. Do not modify production code, create external artifacts, merge or deploy as part of verification.
