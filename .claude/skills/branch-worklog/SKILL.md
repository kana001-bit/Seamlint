---
name: branch-worklog
description: Create or update `docs/branch/<current-branch>.md` work notes for the active Git branch. Use when an agent is asked to leave a branch plan, progress log, handoff memo, or session-to-session status file for the current branch. Do NOT use for a long-lived spec that outlives one branch or needs confirmed-vs-open facts pinned with evidence — that is task-spec-manager (`docs/task-specs/`).
---

# Branch Worklog

Keep branch-scoped work notes lightweight and current. This skill creates the right file for the active
Git branch and keeps a stable structure that another AI or a later session can resume quickly.

## Workflow

1. Run `node ./.claude/skills/branch-worklog/scripts/ensure_branch_note.mjs` from the repository root.
2. Read `references/branch-note-format.md`.
3. If the branch note already exists, update it in place. Do not replace useful history.
4. Keep `Plan` focused on the next concrete steps. Keep `Progress` as dated facts, not intentions.
5. Before ending the task or session, refresh `Progress`, `Validation`, and `Next Handoff`.

## Operating Rules

- Derive the file location from `git branch --show-current`.
- Preserve `/` in branch names as nested folders under `docs/branch/`.
  Example: `feature/gathereed-seam` -> `docs/branch/feature/gathereed-seam.md`
- If Git is detached or the branch name is empty, stop and ask for direction instead of guessing.
- Prefer short updates over long prose. The note is a restart aid, not a design document.
- Record checks that were run and checks that were skipped with a reason.
- When inferring the current goal from local context, label it as an inference until the user confirms it.

## Files

- `scripts/ensure_branch_note.mjs`
  - Creates the branch note if it does not exist and prints the resolved path.
- `references/branch-note-format.md`
  - Canonical section layout and update rules for the note body.
