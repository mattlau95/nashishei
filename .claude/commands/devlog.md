---
description: Draft a devlog entry for completed work and append it to DEVLOG.md
argument-hint: "[ticket id(s), e.g. MAT-476 — optional]"
allowed-tools: Bash(git log:*), Bash(git diff:*), Bash(git rev-parse:*), Bash(date:*), Bash(ls:*), Read, Write, Edit
---

You are writing a new entry in `docs/DEVLOG.md` for the work just completed. Follow this process exactly.

## 0. Ensure the devlog exists

Check whether `docs/DEVLOG.md` exists (`!ls docs/DEVLOG.md`). If it does **not**, create it with the scaffold below before doing anything else. Fill `[Project Name]` from PROJECT.md's H1 title if present, otherwise the repo/directory name.

```markdown
# Devlog: [Project Name]

## Template (Copy this for new entries)
## [YYYY-MM-DD] - [Summary]
**Session Goal:** [Goal]
**Status:** [Completed/Partially Completed/Blocked]

### The "Why" (Decision Log)
* **Resolution:** [Why this was the right path]

### Technical Notes
* [Stack changes, bugs, or refactors]

### Next Session
* [Task 1]

---
## History (Log Entries start here)

```

New entries are appended under the `## History` marker, chronological, newest at the bottom.

## 1. Gather context (don't ask the user for what you can read)

**Previous devlog entry — read it for continuity.** Open `docs/DEVLOG.md` and read the most recent entry. Use it to:
- set the rough lower boundary for this session's diff (work since that entry),
- carry forward its **Next Session** list — those items are likely what this session tackled; check which got done,
- match the established voice and structure,
- avoid re-logging decisions already recorded.

**The session's changes:**
- `!git log --oneline -20`
- `!git diff --stat HEAD~5..HEAD` (widen the range if the session was bigger — use the last devlog entry as the boundary)
- `!git diff HEAD~5..HEAD` for detail where you need it.

**Ticket spine:** if a ticket id was passed in `$ARGUMENTS`, treat it as the entry's spine. Otherwise infer the unit of work from the commits and branch name.

**Date:** use the real current date (`!date +%Y-%m-%d`), never a guess.

**PROJECT.md — reference it, but only for these three things:**
1. Project name (for the scaffold header in step 0).
2. Phase / ticket vocabulary, so the entry uses the same terms as the plan.
3. **Divergence check (the valuable one).** If a decision this session contradicts what PROJECT.md says, surface it: note it in the entry AND tell the user plainly — "this contradicts PROJECT.md §X; reconcile the doc or log it as a deliberate deviation." The devlog is where plan-vs-reality drift gets caught before the doc silently goes stale.

> Do **NOT** use PROJECT.md as a source for the "Why" bullets. It describes what the plan *intended*, not what actually happened this session. Pulling rationale from it produces plausible-but-false reasoning — the exact thing the ⚠️ markers in step 3 exist to prevent.

## 2. Draft the entry against the house template

Match the *style of the existing entries*, which is richer than the bare template:

```
## [YYYY-MM-DD] - [Short summary of the work]
**Session Goal:** [one line]
**Status:** [Completed ✅ / Partially Completed / Blocked]

### The "Why" (Decision Log)
* **[Decision in the form "X over Y"]:** [why this path, and crucially why the alternative was rejected]

### Technical Notes
* [Concrete stack changes, bugs hit, gotchas — the mechanical record]

### Next Session
* [What's queued next]
```

## 3. The split that matters

The **"Why" bullets are the whole point of this log, and they're the part only the human knows.** Your job is to make them easy to confirm, never to invent reasoning.

- **Technical Notes:** fill these yourself from the diff. Bugs fixed, libs added, config changed, non-obvious gotchas. Mechanical — be specific and accurate.
- **The "Why" / Decision Log:** extract candidate decisions from the diff, commit messages, and code comments. Phrase each as **"X over Y"** and write the rejected-alternative reasoning *only where the evidence actually shows it* (a commit message, a comment, a removed approach in the diff).
  - Where you can see *what* changed but not *why* the alternative was dropped, write the decision header and mark the reasoning: `> ⚠️ CONFIRM: why was [alternative] rejected?`
  - Do **not** smooth these over with plausible-sounding rationale. A reconstructed "why" that reads fine but isn't what actually happened is worse than a blank, because future-you will trust it. A flagged gap is honest; a confident fabrication is a landmine.

## 4. Present, then append

- Show the drafted entry in chat first, with the ⚠️ CONFIRM markers and any PROJECT.md divergence flags visible.
- Ask the user to fill or correct the flagged "why" bullets. Wait for their input.
- Once they confirm, append the finalized entry under `## History` in `docs/DEVLOG.md`, after the last entry. Strip remaining ⚠️ markers. Don't touch earlier entries.

## 5. Timing reminder

This log is most valuable written *as the ticket closes, before the next one starts* — rejected alternatives are still warm. If you're reconstructing from days-old memory, flag more aggressively rather than guessing.

---
Ticket(s) for this entry: $ARGUMENTS
