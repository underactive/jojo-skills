# Jojo Skills

Claude Code skills for multi-persona code auditing, prompt engineering, and repository fingerprinting.

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

### `/jojo-fingerprint`

Scans a repository and reports its tech stack: languages with percentage distribution, frameworks, test runners, linters, entry points, package manager, monorepo tool, workspace packages, architecture docs, and per-component project structure. Ported from the `kaicho` project's `repo-context` module into a self-contained Node.js script — zero runtime dependencies beyond Node 20+.

Output uses a hybrid rendering strategy to avoid Claude Code's Bash-output collapse behavior: the distribution bar renders as a single ANSI-colored line in the Bash tool output block (under the collapse threshold), while the rest of the report renders inline as markdown in the assistant response. No `ctrl+o` expansion needed.

```
/jojo-fingerprint                                  # fingerprint current directory
/jojo-fingerprint ~/code/my-repo                   # fingerprint a specific path
/jojo-fingerprint /path/to/repo --json             # raw JSON output
```

The bundled script at `jojo-fingerprint/bin/fingerprint.mjs` also works as a standalone CLI for direct terminal use, with full colorized output in a TTY:

```sh
node ~/.claude/skills/jojo-fingerprint/bin/fingerprint.mjs ~/code/my-repo
```

Supported detection ecosystems: JavaScript/TypeScript (package.json), Python (pyproject.toml), Go (go.mod), Rust (Cargo.toml), Java/Kotlin (Gradle, Maven), C#/F# (.NET/MSBuild), C/C++ (CMake, Meson, SCons, PlatformIO), Swift (Package.swift, Xcode projects).

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
cp -r jojo-fingerprint ~/.claude/skills/
```

Skills appear as `/jojo-audit-all`, `/jojo-audit-changes`, `/jojo-prompt-clear`, and `/jojo-fingerprint` in Claude Code.

`/jojo-fingerprint` requires Node 20+ on `$PATH`. The other skills have no runtime dependencies.

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
