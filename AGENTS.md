# AGENTS.md — Seamlint Agent Rules

This file is the single source of truth for agent conventions in this repository.
`CLAUDE.md` is a thin pointer to this file and must not duplicate any rule here.
Every tool that reads agent instructions (Claude Code, Codex, Cursor, other agents) follows this file.

Keep this file thin and always-on. Detailed working rules live in `.claude/skills/`; read only the skill and reference you need for the change in front of you.

## Working principles

- Read before you write. Confirm existing code, contracts, and docs before changing them.
- Start a multi-step task (3+ steps) with a plan when the tool supports it.
- Seamlint's numbers flow into physical cutting and sewing. The worst failure is a **confidently-wrong measurement**, not a crash. When you are unsure whether geometry can be measured safely, stop and say so rather than measuring silently.

## Scope of work

- Do only what was asked. Do not add unrequested investigation, refactors, or "improvements".
- Do not run lint / typecheck / build as a side quest. **Exception:** when you change measurement or diagnostic behavior, verifying that change is part of the change, not extra work — see [Verification](#verification).
- When done, report what changed briefly and stop. If a decision is ambiguous, ask instead of guessing.

## Project Skills

The skills are canonical under `.claude/skills/` (Claude is the main tool). Codex reads the same skills via thin pointers in `.codex/skills/` that route back to `.claude/skills/` — so edit rules only in `.claude/skills/`, never in the pointers.

Use only the reference inside a skill that the current change needs.

| Work | Skill |
| --- | --- |
| Seamlint implementation change (geometry, rules, core, CLI, diagnostics, docs, Loomit boundary) | `.claude/skills/seamlint-implementation/` |
| Adding or changing tests and fixtures | `.claude/skills/test-writing/` |
| Reviewing a working diff or a PR | `.claude/skills/code-review/` |
| Long-task spec, confirmed-vs-open facts, cross-session handoff | `.claude/skills/task-spec-manager/` |
| Branch-scoped plan, progress log, handoff for the current Git branch | `.claude/skills/branch-worklog/` |

### Read `.claude/skills/seamlint-implementation/` when

- touching `src/` geometry parser, sampler, vector math, rules, core, or CLI
- changing diagnostic shape, code, severity, target, or JSON/text output
- adding or changing examples, fixtures, or sample commands
- editing Loomit contracts, rule registration, project docs, or `AGENTS.md`

### Read `.claude/skills/test-writing/` when

- adding or updating anything under `test/` (`node:test` specs or fixtures)
- proving a rule with both a "should warn" and a "must not warn" fixture

### Read `.claude/skills/code-review/` when

- reviewing the working diff or a PR before it merges
- you want a false-positive-resistant read of a geometry or diagnostics change

### Read `.claude/skills/task-spec-manager/` when

- a task spans multiple sessions and needs confirmed vs open facts pinned outside chat
- writing or updating anything under `docs/task-specs/`

### Read `.claude/skills/branch-worklog/` when

- creating or updating anything under `docs/branch/`
- leaving a plan, progress log, or handoff for the current Git branch

## Always protect these boundaries

- Never measure silently when the geometry assumptions are broken. Unsupported `transform`, non-unit `viewBox` scaling, unsupported SVG commands, invalid DXF paths, and too-few-points cases must become explicit `error` diagnostics. See `.claude/skills/seamlint-implementation/references/critical-invariants.md`.
- Seamlint is a read-only geometry linter. Do not add auto-fix or CAD editing behavior unless the user explicitly asks for a design change.
- Keep rule evaluation separate from CLI display and exit status. Rules return structured diagnostics; formatters and the CLI render them.
- Treat `code`, `target`, `severity`, `actual`, `expected`, and `suggestion` as downstream contract fields. Do not casually rename them.
- Geometry sources are SVG and ASTM DXF. Unless the task is explicitly about unit support, treat coordinates as `mm` and `scale` as `1`. The MVP SVG parser stays limited to `M`, `L`, `H`, `V`, `C`, `Q`, and `Z`.
- Keep work notes short, factual, and dated. Prefer appending progress over rewriting history.

## Reading order

- Narrow the change surface first, then read only the references that matter.
- If older docs are garbled, prefer `README.md`, current source code, and readable ASCII sections.

## Verification

- When behavior changes, run the relevant sample command. Default: `npm run check:sample`.
- If JSON output changes, also run `npm run check:sample-json`.
- If seam comparison logic changes, also run a direct `node ./src/cli/slnt.ts check ... --compare-to ...` command.
- If rule/diagnostic logic changes broadly, run `npm run typecheck` and `node --test`.
- If branch-note tooling changes, run `node ./.claude/skills/branch-worklog/scripts/ensure_branch_note.mjs`.
- If any check could not run, say why.

## Work notes

- Branch-scoped plan / progress / handoff: `docs/branch/<branch>.md` via `branch-worklog`.
- Long-task specs (confirmed vs open, with evidence): `docs/task-specs/<slug>/task-spec.md` via `task-spec-manager`.
- Do not promote a guess to a "confirmed" fact. Record inferences and open questions as such, with the file, function, or answer date that backs them.
