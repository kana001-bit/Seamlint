# Seamlint Agent Rules

This file only keeps the always-on entry points.

- Read `skills/seamlint-implementation/` for Seamlint implementation rules.
- Read `skills/branch-worklog/` for branch-scoped plan, progress, and handoff notes.

## Read `skills/seamlint-implementation/` when

- touching `src/` geometry parser, sampler, vector math, rules, core, or CLI
- changing diagnostic shape, code, severity, target, or JSON/text output
- adding or changing examples, fixtures, tests, or sample commands
- editing Loomit contracts, rule registration, project docs, or `AGENTS.md`

## Read `skills/branch-worklog/` when

- creating or updating anything under `docs/branch/`
- leaving a plan, progress log, or handoff for the current Git branch
- preparing work so another session or another AI can resume quickly

## Always protect these boundaries

- Never measure silently when the geometry assumptions are broken. Unsupported `transform`, non-unit `viewBox` scaling, unsupported SVG commands, and too-few-points cases must become explicit `error` diagnostics. See `skills/seamlint-implementation/references/critical-invariants.md`.
- Seamlint is a read-only geometry linter. Do not add auto-fix or CAD editing behavior unless the user explicitly asks for a design change.
- Keep rule evaluation separate from CLI display and exit status. Rules return structured diagnostics; formatters and the CLI render them.
- Treat `code`, `target`, `severity`, `actual`, `expected`, and `suggestion` as downstream contract fields. Do not casually rename them.
- Unless the task is explicitly about unit support, treat coordinates as `mm` and `scale` as `1`. MVP SVG support stays limited to `M`, `L`, `H`, `V`, `C`, `Q`, and `Z`.
- Keep branch notes short, factual, and dated. Prefer appending progress over rewriting history.

## Reading order

- Narrow the change surface first, then read only the references that matter.
- If older docs are garbled, prefer `README.md`, current source code, and readable ASCII sections.

## Verification

- When behavior changes, run the relevant sample command. Default: `npm run check:sample`.
- If JSON output changes, also run `npm run check:sample-json`.
- If seam comparison logic changes, also run a direct `node ./src/cli/slnt.ts check ... --compare-to ...` command.
- If branch-note tooling changes, run `node ./skills/branch-worklog/scripts/ensure_branch_note.mjs`.
- If any check could not run, say why.
