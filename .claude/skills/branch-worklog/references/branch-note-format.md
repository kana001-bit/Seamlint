# Branch Note Format

Use this format for every `docs/branch/...` note.

## File Mapping

- Resolve the current branch with `git branch --show-current`.
- Keep slash-separated branch names as nested folders under `docs/branch/`.
- Add `.md` only to the last branch segment.

Examples:

- `main` -> `docs/branch/main.md`
- `feature/gathereed-seam` -> `docs/branch/feature/gathereed-seam.md`
- `fix/cli/json-output` -> `docs/branch/fix/cli/json-output.md`

## Required Sections

```md
# Branch Worklog: `branch/name`

## Goal

Short outcome statement. If inferred from files or branch name, say so.

## Plan

- [ ] Next concrete step
- [ ] Test or documentation follow-up

## Progress

- YYYY-MM-DD: Fact about work completed, decisions made, or blockers discovered.

## Open Questions

- Item that still needs confirmation, if any.

## Validation

- `command run here` - pass/fail or skipped with reason

## Next Handoff

One short paragraph on where the next session should resume.
```

## Update Rules

- Keep `Goal` stable unless the branch intent changes.
- Reorder `Plan` so the top unchecked item is the next recommended action.
- Append new `Progress` entries with dates. Do not rewrite older entries unless they are incorrect.
- Keep `Validation` honest. Include commands that failed to run or were intentionally skipped.
- Refresh `Next Handoff` whenever the branch state changes meaningfully.
