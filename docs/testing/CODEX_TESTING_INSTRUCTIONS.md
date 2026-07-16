# Repository Testing Workflow

## Session entry

1. Read `AGENTS.md` and every file in `docs/testing/`.
2. Inspect `git status` and preserve unrelated changes.
3. Resume from `SESSION_HANDOFF.md`; verify stale assumptions against source.
4. Discover architecture, runtime, data stores, APIs, UI routes, authentication, authorization, integrations, and test tooling from source.
5. Update `PROJECT_PROFILE.md` and `MODULE_INDEX.md` immediately after discovery batches.
6. Select the highest-risk incomplete module and work through one business flow at a time.

## Module loop

For each module: define detailed test cases and expected results; automate practical cases; execute tests; capture evidence; report only reproducible bugs; identify root cause; make the smallest safe fix; rerun the reproduction; run relevant regression tests; and update all tracking files after each batch.

Statuses: `Not started`, `In progress`, `Passed`, `Failed`, `Blocked`, `Complete`. A module is not `Complete` while a confirmed Critical/High bug is unresolved unless the bug is `Blocked` with evidence and a concrete unblock condition.

If an automated test conflicts with existing source or business documentation, mark it `Needs Business Confirmation`, record the conflict and evidence, do not change the related logic, and continue unblocked cases. If a bug fix necessarily changes business logic, record it as `Blocked — Requires Business Decision` and wait for direct approval. Fixes must preserve existing valid behavior, API contracts, historical data, formulas, roles, permissions, states, and flow order unless the user explicitly authorizes a change.

## Safety and evidence

- Never run destructive tests against production data or services.
- Never mark a test passed unless its command was executed and the observed result matched the expected result.
- Do not change expectations, delete tests, or skip failures to hide a defect.
- Bugs require source, test, command, log, API, database, or reproducible UI evidence.
- Preserve unrelated user changes. Do not claim 100% coverage without measured evidence.
- Never redesign or reinterpret business logic to make a test pass. Only correct implementation that demonstrably violates an existing rule.
- After every fix, rerun the reproduction and relevant regression tests to prove both the correction and preservation of valid flows.

## Tracking cadence

Immediately update the relevant test-case file, `TEST_PROGRESS.md`, `BUG_TRACKER.md`, `DECISION_LOG.md`, and `SESSION_HANDOFF.md` after each discovery batch, flow, test run, bug, fix, regression run, blocker, or important decision. The handoff must always name the active module, last test case, last command/result, open bugs, blockers, changed files, and exact next action.

> Provenance: this file was absent from the repository on 2026-07-11. This baseline was reconstructed from `AGENTS.md` and the user's explicit testing requirements; see `DECISION_LOG.md`.
