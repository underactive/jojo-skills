# Jojo Skills

Claude Code skills for multi-persona code auditing and prompt engineering.

## Skills

### `/jojo-audit-all`

Full codebase audit using parallel reviewer subagents. Reviewers explore the codebase independently using Glob, Read, and Grep, then findings are synthesized with conflict detection and sequential fix application.

```
/jojo-audit-all                                    # interactive flow
/jojo-audit-all src/api/                           # scoped to directory
/jojo-audit-all specialist                         # skip to specialist tier
/jojo-audit-all Security Engineer, Kent Beck       # specific reviewers
/jojo-audit-all all                                # all 29 reviewers
```

### `/jojo-audit-changes`

Same workflow as above, but reviews uncommitted git changes (`git diff` + `git diff --cached`) instead of the full codebase.

```
/jojo-audit-changes                                # interactive flow
/jojo-audit-changes holistic                       # holistic tier
/jojo-audit-changes Martin Fowler, Sandi Metz      # specific personas
```

### `/jojo-prompt-clear`

Rewrites prompts using the CLEAR framework:

- **C**lear and scoped
- **L**ogical structure
- **E**xplicit constraints
- **A**uditable (easy to verify)
- **R**eproducible results

```
/jojo-prompt-clear write a function that does auth
```

## Reviewer Tiers

| Tier | Count | Default | Description |
|------|-------|---------|-------------|
| Holistic | 5 | Principal Engineer | Broad, system-wide perspective |
| Specialist | 14 | Code Quality Engineer | Domain-specific expertise |
| Persona | 10 | none | Famous engineer perspectives |

### Holistic Reviewers
Principal Engineer, Software Architect, Full-Stack Engineer, Reliability Engineer, Staff Engineer

### Specialist Reviewers
Code Quality, Security, Testing, Frontend, Backend, Performance, Accessibility, DevOps, Data, Infrastructure, DX, Mobile, Documentation, AI Engineer

### Persona Reviewers
Martin Fowler, Kent Beck, Sandi Metz, Rich Hickey, Anders Hejlsberg, John Ousterhout, Kamil Mysliwiec, Kent Dodds, Tanner Linsley, Vladimir Khorikov

## Model Strategy

The audit skills use different models for different phases:

| Phase | Model | Rationale |
|-------|-------|-----------|
| Step 4 - Code Review | Opus | Maximum reasoning depth for finding issues |
| Step 8 - Fix Application | Sonnet | Fast, cost-effective for mechanical edits |

Model overrides apply only to subagents. The parent conversation's model is unaffected.

## Installation

Copy skill directories to `~/.claude/skills/`:

```sh
cp -r jojo-audit-all ~/.claude/skills/
cp -r jojo-audit-changes ~/.claude/skills/
cp -r jojo-prompt-clear ~/.claude/skills/
```

Skills appear as `/jojo-audit-all`, `/jojo-audit-changes`, and `/jojo-prompt-clear` in Claude Code.

## Audit Workflow

```
Step 1  Codebase discovery & scoping
Step 2  Tier selection (Holistic / Specialist / Persona)
Step 3  Reviewer selection (Defaults / All / Pick specific)
Step 4  Parallel review via Opus subagents (max 5 concurrent)
Step 5  Conflict analysis (contradictions, risky fixes, critical items)
Step 6  User resolution of conflicts
Step 7  Issue listing in kaicho format
Step 8  Sequential fix application via Sonnet subagent
Step 9  Summary
```
