# Spike — Viewing names at scale ("show all the names")

*Status: ideation. Supersedes the assumption baked into T5 / Phase-2 robust all-labels.*

## Problem

Elder John's headline ask — "show all the names at once" — does not survive contact
with real group photos. Confirmed at Phase-2 completion: even the robust boundary-labeling
build (margin placement, leader lines, crossing minimization) becomes unreadable past
~12–15 faces. Labels cover faces or each other; at 20–40 it's a nightmare. This is not a
layout bug to out-clever — it's a screen-physics limit.

## Core reframe

"Show all labels at once" was a **stated solution**, not the job. The job is:

> *"Let me look at a photo of my congregation and be told who everyone is, without work."*

The screen-physics constraint, stated plainly: on a phone you cannot simultaneously have
all three of —

1. every **name** shown,
2. each person's **spatial position**, and
3. **legible** type

— past ~12–15 faces. Something must give. So the design move is not "make the overlay
better." It's **pick which two to keep, per viewing mode, and switch modes by face count.**

## Decompose the job

"See who's here" is actually three different jobs that want different UI:

| Job | Question | Best surface |
|-----|----------|--------------|
| **Browse** (gestalt) | "Who's all here?" | roster surface (grid / sequence) — *off the photo* |
| **Locate** | "Where is Grace standing?" | search → highlight on photo |
| **Identify** | "Who is *that* one?" | tap-a-face-to-reveal (T4, built) |

**Elder John's ask is Browse.** Browse is the one we've been trying to serve *on* the
photo, and it's the one that least belongs there.

## The "off the photo" principle

A photo's layout is imposed by physics (people stand where they stand; faces are tiny and
packed). A list/grid/sequence is laid out by us (we control type size, spacing, scroll).
So move the *reading* task onto a surface we control; demote the photo to a spatial
reference the roster links back to. Map ↔ legend: the photo carries position, the roster
carries the dense text.

Precedent we already set: **MAT-476** (naming screen) is already off-photo — cropped faces
in a vertical list with the name field beside each, because typing into 40 boxes over a
photo would be miserable. Viewing has the same density problem and wants the same solution.

## Option matrix

Verdict + which of {name / position / legible} each one sacrifices.

| Option | Sacrifices | Build cost | Verdict |
|--------|-----------|-----------|---------|
| Simultaneous on-photo labels (current) | nothing ≤12; *everything* >15 | done | **Keep, but count-gate to ≤12** |
| Numbered faces + name list ("who's who" key) | name-on-face (split to a list) | low | **Strong** for medium-dense; scales to 200 |
| Cast grid (crop + name caption) | position | **very low — reuse MAT-476** | **Ship.** Legible, mobile-native, infinite scale; tap cell → pulse box on photo |
| Auto-spotlight "play" mode | simultaneity | low (have crops/boxes/names) | **Prototype first.** Zero-tap, one big name at a time — nails Elder John's emotional ask |
| Excentric labeling (finger-neighborhood fan-out) | — (shows only local neighborhood) | medium | **Prototype as "explore in place" complement.** Touch/90yo ergonomics unproven |
| Semantic-zoom labels | simultaneity (zoom-gated) | medium | **Secondary.** Honors photo-is-hero but needs active zoom/pan |
| Search-to-find | — (serves Locate, not Browse) | low | **Keep for scale** |
| Tap-to-reveal (T4) | — (serves Identify) | done | **Keep** |

*Excentric labeling: Fekete & Plaisant, CHI '99 — dynamic neighborhood labeling. Labels for
the ~N nearest objects to the cursor fan out into empty space, non-overlapping, updating
live; low compute, non-intrusive. Designed for mouse hover — validate on touch.*

## Recommendation

**The Browse job at scale is served off the photo.** Build:

1. **Cast grid** — the legible workhorse. Cheap reuse of MAT-476. Tap a cell → its box
   pulses on the photo (keeps the spatial link).
2. **Auto-spotlight "play" mode** — the delight. Dim the photo, highlight one face at a
   time, show that one name large, auto-advance on a timer (tap to pause / step). This is
   "show me all the names" reimagined as *sit back and watch* — and it's the version of the
   ask that actually fits a 90-year-old: no tapping, maximum legibility, one name at a time.

Keep tap-to-reveal (Identify) and search (Locate) underneath. Keep the photo as the spatial
anchor both modes link to.

**Mode selection by face count (auto):**

- **≤ 12** → existing simple all-labels (it works; it's the real "at a glance" gestalt at
  small N). Don't delete it — gate it.
- **> 12** → default to grid + spotlight; tap-reveal + search available.

This also means the app never shows Elder John a broken dense overlay — the count picks the
right mode for him.

## Validate with Elder John

- Does the spotlight "play" land as the wow moment, or does he specifically want the
  whole-group-at-a-glance gestalt (→ then it's the numbered key, not the grid)?
- Pace: timer auto-advance vs. tap-to-advance. (Lean tap-to-advance + optional autoplay.)
- Multi-part romanized names (e.g. "Kuan Yuen Chang") must render whole and large in the
  spotlight card — confirms the multilingual `display_name` decision visually.

## Next actions

- [ ] Pick primary Browse mode from Elder John feedback (grid+spotlight vs numbered key)
- [ ] Ticket: viewing-mode count threshold + mode switch
- [ ] Ticket: cast grid viewer (reuse MAT-476 crop component) + tap-cell→pulse-box link
- [ ] Ticket: spotlight play mode
- [ ] Demote T5 robust all-labels from Phase 2 (keep simple all-labels, count-gated)
