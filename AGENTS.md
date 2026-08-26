# AI Development Rules

Before modifying production code, read:

- `STABILITY_CONTRACT.md`

The Stability Contract is normative.

## Mandatory rules

1. Identify the affected `RWT-*` invariants before changing code.
2. Do not weaken or remove tests to make them pass.
3. Every bug fix must include a regression test when technically possible.
4. Do not increase timeouts to hide races.
5. Do not add retries to hide flaky behavior without identifying the root cause.
6. Run all pertinent tests after every modification.
7. Do not use `--forceExit` to hide resource leaks.
8. If an invariant must change, update the Stability Contract and add a regression test before considering the change complete.
9. Keep changes minimal and scoped to the current task.
10. Do not refactor unrelated code while fixing a known issue.

## Workflow

For each task:

1. Inspect the relevant implementation.
2. Inspect existing tests.
3. Identify affected invariants and known issues.
4. Write/reproduce the regression test.
5. Make the smallest production change necessary.
6. Run the focused test.
7. Run the relevant existing suites.
8. Report changed files, tests executed, and remaining risks.
