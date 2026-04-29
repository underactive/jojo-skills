---
name: jojo-summarize
description: Emit a self-contained handoff summary of the current conversation plus a ready-to-paste resume prompt, so the user can run /clear and continue in a fresh context without losing state. Use when the conversation has grown long, has wandered, or the user explicitly asks to compact and continue.
user-invocable: true
---

# Conversation Handoff for /clear

The user wants to reset the conversation with `/clear` without losing state. A Claude Code skill cannot invoke `/clear` itself — only the user can run slash commands. Your job is to (1) emit a complete handoff summary, (2) emit a self-contained resume prompt in a fenced block the user can copy verbatim, and (3) tell the user to run `/clear` and paste the block as their next message.

## Hard constraints

- DO NOT attempt to run, trigger, or simulate `/clear` yourself. It is a user-typed slash command. Any instruction to "then run /clear" must be directed at the user, not performed by you.
- DO NOT reference prior tool outputs, scrollback, or earlier assistant messages in a way that depends on them still being visible after `/clear`. The resume prompt must stand on its own.
- DO NOT include secrets, credentials, or tokens encountered in the conversation. If a sensitive value is load-bearing for the next step, describe the *kind* of value needed and how to retrieve it, never the value itself.
- DO NOT paraphrase file paths, function names, or commands — preserve them verbatim.
- DO NOT compress so aggressively that the next step becomes ambiguous.

## Output — emit exactly these four sections, in this order

### 1. `## Summary`

Bulleted list covering:
- **Goal** of the session (one line).
- **Work completed** — concrete actions in order. Include file paths edited, commands run, external systems touched.
- **Decisions made** — choices that were deliberately settled, with a one-line reason each.
- **Open questions / known issues** — anything unresolved that must carry forward.

### 2. `## Next Step`

Short prose (2–6 sentences) covering:
- The single next goal.
- The first concrete action to take.
- Any blockers or prerequisites.
- Any constraints to remember (e.g., "do not modify file X").

### 3. Fenced resume prompt

A single fenced code block with language tag `markdown` containing a standalone prompt the user will paste after `/clear`. It must:
- Restate the goal in one sentence.
- List salient state (files touched, decisions made, open questions) as compact bullets.
- State the immediate next action clearly.
- Include any constraints carried over.
- Read naturally as a cold-start prompt — no "as discussed," no "continuing from above."

Aim for ≤ 60 lines. Focused, not a transcript.

### 4. Closing instruction

One line, outside the code block:

> Run `/clear`, then paste the block above as your next message to resume.

## Self-check before emitting

- [ ] Could a fresh Claude, with zero prior context, act correctly on the resume prompt alone? If not, add what's missing.
- [ ] Does every file path, command, and decision appear verbatim (not paraphrased)?
- [ ] No secrets leaked?
- [ ] You did not instruct yourself to run `/clear`.
