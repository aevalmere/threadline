---
name: webforge-explain
description: >-
  Explains a web decision, system, or diff at the altitude the reader needs: mental model before mechanics, at
  most two disclosure levels, shaped as a decision record, trade-off table, change brief, or review comment,
  with confidence stated per claim. Use for "why did you do it this way", "how does this work", or a code
  review. Use this even when unnamed. Not for fixing the code itself.
metadata:
  pack: webforge
  kind: explain
  domain: writing,architecture
  version: "1.0.0"
---

# WebForge Explain
Turns a decision, a system, or a diff into an explanation the reader can act on. Standalone: this skill
references no other FORGE skill.

## Activation receipt

Standing rule for the rest of this session, every turn, not just the first:

Whenever this skill's guidance shapes your response, end the reply with exactly one line, after a blank
line, as the last thing in the visible output:

    [skills: name1 > name2]

List every skill that fired this turn, FORGE or not, in the order it fired, by its full name. If this skill
ran alone, write `[skills: webforge-explain only]`. If a skill you intended to call was not on disk, add one
short parenthetical: `[skills: webforge-explain (<missing-skill> absent)]`.

Never write a second such line, a heading above it, a banner, or any explanation of it. Never put it inside a
code fence. This line is the only permitted trace of the machinery; everything else about phases, defect
logs, and refinement cycles stays hidden.

## Three rules that decide the shape

1. **Mental model before mechanics.** Give the one sentence that makes the rest predictable before giving any
   API name. A reader who has the model can derive the details; a reader who has only details cannot derive
   the model.
2. **Two disclosure levels, never three.** Level 1 is the one-paragraph summary that stands alone. Level 2 is
   the full brief or trade-off table. Designs that go past two levels lose people between the levels.
3. **Detect expertise first.** If this pattern already appears in this repo or has come up in this session,
   skip the worked example and give the terse mechanic. Worked examples help a reader without an existing
   model and actively slow down one who has it.

## Pick the output shape

| Reader needs | Shape |
|---|---|
| To act: reply, approve, ship | BLUF. Conclusion or ask in sentence one |
| To decide between options | Trade-off table |
| A durable record of why | Architecture decision record |
| To review a change | Change brief |
| Feedback on their code | Conventional comment |
| To understand a mechanism | One worked example, then the terse rule |
| Topology, flow, or hierarchy | A diagram (Mermaid, or ASCII where Mermaid will not render) |
| More than two discrete dimensions compared | A table. Do not force a flowchart onto a comparison |

## Architecture decision record

```
# Title, a present-tense imperative phrase

## Status
Proposed | Accepted | Superseded by ADR-00XX

## Context
The forces at play, technical and business, stated as neutral fact.

## Decision
The change being made, stated actively: "We will ..."

## Consequences
What becomes easier and what becomes harder. Both directions.
```

ADRs are immutable. A changed decision is a new ADR superseding the old one, never an edit. The record is a
history, not a wiki page.

## Trade-off table

Rows are the options considered, including "do nothing". Columns are the two to four goals that actually
matter. Cells say how each option scores against each goal. The rejected options' losses are stated plainly,
not hand-waved.

| Option | Time to ship | Ops burden | Cost at 100k users | Reversible |
|---|---|---|---|---|
| Hosted auth provider | 1 day | none | scales per MAU, check the pricing page | migration is weeks |
| Self-hosted library | 3 days | backups, email deliverability, rate limiting | flat infra cost | easy |
| Hand-rolled sessions | 1 week | all of the above plus the security surface | flat | easy |
| Do nothing | 0 | none | none | n/a |

Pair it with an explicit **Non-Goals** section: things that could reasonably be goals but were deliberately
excluded. That is what "what I did not do" means concretely. It is a falsifiable claim, not a caveat
paragraph, and it is the opposite of the both-sides hedge.

## Change brief

- **First line**: a complete sentence in imperative mood, standing alone as a summary the reader never needs
  the body to understand. "Delete the FizzBuzz RPC and replace it with the new system." Then a blank line.
- **Body**: the problem being solved, why this approach, and explicitly any shortcomings of it. Plus issue
  numbers, benchmark output, and doc links, because context evaporates and links rot.
- **Never** a first line like: "Fix bug." "Fix build." "Add patch." "Moving code from A to B." "Phase 1."
- **Size**: about 100 lines is a reasonable change; 1,000 is usually too large. File spread matters more than
  line count.

## Review comments

`<label> [decorations]: <subject>` then optional discussion. Labels: `praise`, `nitpick` (non-blocking),
`suggestion`, `issue`, `todo`, `question`, `thought` (non-blocking), `chore`, `note` (non-blocking).

```
issue (blocking): deletePost trusts the caller's postId without an ownership check.
                  Any authenticated user can delete any post. Add the authorId comparison.
nitpick (non-blocking): the retry count could be a named constant.
```

The reviewer standard to hold your own output to: approve once the change definitely improves the health of
the system, even if it is not perfect. Better, not perfect.

## Calibrated confidence

Attach confidence to the specific claim, never as a blanket disclaimer at the end.

| Band | Rough probability |
|---|---|
| Almost certain | 95 percent and up |
| Very likely | 80 to 95 percent |
| Likely | 60 to 80 percent |
| Unclear | 40 to 60 percent |
| Unlikely | 20 to 40 percent |
| Very unlikely | under 20 percent |

Stronger than a hedge word, because it names the required action, use the three tags:

| Tag | Meaning | Action |
|---|---|---|
| `[VERIFIED]` | confirmed by a file read, a command run, or the user's own words | build on it |
| `[DEFAULT]` | unverified, low impact, sensible convention | proceed, disclose it |
| `[LOAD-BEARING]` | unverified, and the conclusion changes materially if wrong | verify or ask |

Every load-bearing claim carries a flip condition: "this holds unless X". A position with no flip condition is
dogma. Ban triple hedging: "may potentially help to possibly improve" says nothing. Hedge once, plainly, or
not at all.

## Analogies

One analogy, used once, then dropped. It lands one specific point and then the explanation returns to the real
domain's own terms. Every analogy is itself an abstraction, and the parts of the source domain that do not map
are exactly where a reader who leans on it gets misled. Never build an extended metaphor a reader could run
with past where it is valid.

## Worked examples

One concrete example beats three abstract sentences for a reader without an existing model. Add a second only
if it is meaningfully different, usually more complex; a third example of the same shape adds nothing
measurable. The best sequence is faded: a full worked example, then a partially worked one, then the rule
alone.

## Quality checklist

- [ ] The first sentence stands alone as the answer.
- [ ] The mental model appears before any API name or config key.
- [ ] There are at most two disclosure levels.
- [ ] Every option in a trade-off table has its loss stated, including the chosen one.
- [ ] What was deliberately not done is named explicitly.
- [ ] Confidence is attached to specific claims, not to the whole document.
- [ ] Every load-bearing claim has a flip condition.
- [ ] Any analogy is used once and dropped.
- [ ] No specific in the explanation is unsourced; each traces to something read or carries `[unverified]`.

## Interop

Defer to a project-local documentation, ADR, or review-convention skill when one exists, and compose with it:
it owns the house format and where the file lives, this skill owns the altitude and the calibration. Name it
in the receipt line. This skill needs nothing else installed; if the rest of the pack is absent it runs
standalone and says so in the receipt.

## Reference files

| File | Read when |
|---|---|
| `references/templates.md` | Filling in an ADR, change brief, design doc, or review comment |
