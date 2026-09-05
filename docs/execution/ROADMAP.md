# Roadmap to a bounded learner pilot

| Sequence | Packet / milestone | Dependency | Exit evidence |
| --- | --- | --- | --- |
| 1 | GAPX-01: shared web/worker durable queue | None | HTTP enqueue visible to a separate worker and survives web restart |
| 1 | GAPX-02: trusted identity boundary | Local adapter specification ready; identity provider decision for integration | Spoofed identity cannot select another owner |
| 1 | GAPX-03: proof execution launch gate | Owner architecture decision for a new sandbox | Public mode cannot execute code in-process; later sandbox contract tests |
| 2 | GAPX-04: authenticated request limits | GAPX-02 before public integration | Atomic quota, Retry-After, no queued work on refusal |
| 3 | Integrated staging journey | Above gates, durable storage, worker lifecycle | Real source → compile → audio → attempt → mastery with restart evidence |
| 4 | Existing GOAL M4 pilot | Release authorization and existing live-evaluation gate | At least five learners finish the defined course/mastery journey |
| 5 | Existing retention goals | Pilot outcomes | Repeat-use evidence and evaluation regressions tracked |

The first durable-queue fix can proceed locally. The remaining packets separate local contracts from external identity/sandbox choices. Do not implement a new primary architecture by treating a proposed design here as approval; AGENTS approval requirements continue to apply. Work in open PR #15 may alter the same learner journey and bootstrap paths, so rebase and reassess before selecting overlapping work.
