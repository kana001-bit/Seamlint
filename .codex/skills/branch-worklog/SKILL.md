---
name: branch-worklog
description: Create or update `docs/branch/<current-branch>.md` work notes for the active Git branch. Use when an agent is asked to leave a branch plan, progress log, handoff memo, or session-to-session status file for the current branch. Do NOT use for a long-lived spec that outlives one branch or needs confirmed-vs-open facts pinned with evidence — that is task-spec-manager (`docs/task-specs/`).
---

# Branch Worklog (Codex pointer)

Canonical instructions live in **`.claude/skills/branch-worklog/SKILL.md`** (main is Claude; Codex shares it).
Do not duplicate the rules here.

Open `.claude/skills/branch-worklog/SKILL.md` and follow it. It runs
`node ./.claude/skills/branch-worklog/scripts/ensure_branch_note.mjs` and uses
`references/branch-note-format.md` for the note layout.
