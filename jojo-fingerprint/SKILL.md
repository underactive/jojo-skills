---
name: jojo-fingerprint
description: Fingerprint a repository to detect languages, frameworks, test runners, linters, package manager, monorepo structure, and project components. Displays a one-line colored distribution bar followed by an inline markdown report with a structured PROJECT CONTEXT block.
argument-hint: "optional: path to repository (defaults to current directory), + optional --json"
user-invocable: true
---

# Repository Fingerprint

You run the bundled `fingerprint.mjs` script in a **hybrid output mode**: a single colored distribution bar goes through the Bash tool output (so the user sees the ANSI colors rendered), and the rest of the report goes through assistant-text markdown (so it renders inline without being collapsed). The script is a self-contained Node.js port of the kaicho `fingerprint` feature — no external dependencies beyond Node 20+.

## Step 1 — Parse Arguments

`$ARGUMENTS` may contain:
- A path to fingerprint (relative, absolute, or `~`-expanded). Defaults to `.` (current directory).
- `--json` flag → switches to raw JSON output (bypasses the hybrid flow).

Examples:
- (empty) → fingerprint current directory
- `~/code/my-repo` → fingerprint that path
- `--json` → current directory, raw JSON
- `/path/to/repo --json` → specific path, raw JSON

Let `<PATH>` below be the user-supplied path (or `.` if none). Let `<SCRIPT>` be `/Users/esison/.claude/skills/jojo-fingerprint/bin/fingerprint.mjs`.

## Step 2 — JSON Shortcut

If the user passed `--json`, run a single Bash call:

```bash
node <SCRIPT> <PATH> --json
```

Emit the JSON inside a fenced ```json code block in your assistant response, then stop. Skip Steps 3–5 entirely.

## Step 3 — Run the Hybrid Command

Otherwise, run this **single Bash call** which does both fingerprint invocations and saves the markdown to a temp file:

```bash
FORCE_COLOR=1 node <SCRIPT> <PATH> --bar-only && node <SCRIPT> <PATH> --markdown --no-bar > /tmp/jojo-fingerprint-output.md
```

What this does:
1. The first invocation (`--bar-only`) writes exactly ONE line to stdout: a colored bar made of `█` blocks in per-language colors, followed by the language name and percentage for each. `FORCE_COLOR=1` forces colors on even though stdout is a pipe. This single line is what the user sees in the Bash tool output block — one line is under Claude Code's collapse threshold, so `ctrl+o` to expand is NOT needed.
2. The second invocation (`--markdown --no-bar`) writes a markdown report (heading, bullet list, components, Prompt block) to `/tmp/jojo-fingerprint-output.md`. The `--no-bar` flag suppresses the grayscale distribution bar section so the markdown doesn't duplicate what the colored bar already shows. Because stdout is redirected to a file, this second invocation contributes NOTHING to the Bash tool output block.

Net result: the Bash tool output block contains exactly one line — the colored bar.

## Step 4 — Read and Emit the Markdown

Use the Read tool to load `/tmp/jojo-fingerprint-output.md`. Then write an assistant response whose body IS the contents of that file, verbatim.

**Critical rules for Step 4:**
- Do NOT add a heading above the markdown. It already has its own `### Fingerprint: ...` heading.
- Do NOT wrap it in an additional code fence. It's already formatted markdown.
- Do NOT insert an Insight block, a preamble, or a postscript before the AskUserQuestion in Step 5. The markdown is the whole report.
- If the Read tool returns an error (e.g., the file is empty or missing because the Bash call failed), emit a brief error message with what went wrong.

The markdown renders natively in Claude Code's assistant-text pipeline, so the heading becomes a heading, the bullet list renders as a list, inline code spans render in monospace, and the `~~~` fenced Prompt block renders as a copyable code block.

## Step 5 — Present Options

After emitting the markdown, use `AskUserQuestion` with these three options:

1. **Copy prompt block** — extract the content between the `~~~` fences in `/tmp/jojo-fingerprint-output.md` and pipe it to `pbcopy` via Bash.
2. **Save to PROJECT_CONTEXT.md** — copy `/tmp/jojo-fingerprint-output.md` to `PROJECT_CONTEXT.md` at the target repo root.
3. **Done** — no further action.

## Notes

- Script location: `/Users/esison/.claude/skills/jojo-fingerprint/bin/fingerprint.mjs` (self-contained, Node built-ins only, ~1100 lines).
- Script flags summary:
  - `--json` — raw JSON output of the RepoContext data structure
  - `--bar-only` / `--bar` — single-line colored distribution bar (honors `FORCE_COLOR=1`)
  - `--markdown` / `--md` — markdown report (includes grayscale bars by default)
  - `--no-bar` — when combined with `--markdown`, omits the grayscale distribution bar section
  - `--plain` — force plain-text ANSI display mode (no colors, structured terminal layout)
  - (no flag) — colorized terminal display in a TTY; falls back to plain text in non-TTY pipes unless `FORCE_COLOR=1` is set
- The hybrid mode (`--bar-only` + `--markdown --no-bar`) is the only mode designed for skill use. The other modes exist for direct terminal invocation.
- If Node is not installed, tell the user to install Node 20+ from https://nodejs.org/.
