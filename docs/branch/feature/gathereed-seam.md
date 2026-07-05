# Branch Worklog: `feature/gathereed-seam`

## Goal

Inferred from the branch name and current working tree: finish the MVP `gathered-seam`
rule, its diagnostics, and the supporting docs/tests without widening the geometry
contract unsafely.

## Plan

- [ ] Finish wiring `gathered-seam` behavior through `checkGeometryRequest` and stabilize the core tests.
- [ ] Reconcile the docs and diagnostic contract for gather markers, gather ranges, and gather ratio errors.
- [ ] Decide whether cross-source length-only checks stay deferred for MVP or need a scoped follow-up task.
- [ ] Record validation results before handing off.

## Progress

- 2026-07-05: Created this branch worklog.
- 2026-07-05: Working tree already includes gathered-seam implementation and test changes, plus new notes in `docs/seamlint-gathered-seam-notes.md` and `docs/seamlint-immediate-checks.md`.
- 2026-07-05: Added the `branch-worklog` skill and connected `AGENTS.md` so future sessions can resume from `docs/branch/...`.

## Open Questions

- Should length-only cross-source seam checks be enabled during this branch, or left as an explicit follow-up after real export verification?

## Validation

- Not run yet.

## Next Handoff

Resume by checking the current gathered-seam diff against the new notes, then finish the
remaining unchecked plan item at the top before updating tests and validation.
