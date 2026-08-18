---
name: webforge-noslop
description: >-
  Strips AI tells from every word and line of code before it ships: banned words and constructions, em
  dashes, buzzword UI copy, apology-theater error text, plus code smells like unused parameters, silent catch
  blocks, single-call-site config keys, and dead exports. Use when writing or editing copy, a README, a commit
  message, or a PR description, or before calling a diff done. Use this even when unnamed. Not for visual
  design or layout craft.
metadata:
  pack: webforge
  kind: noslop
  domain: writing,code-quality
  version: "1.0.0"
---

# WebForge NoSlop
Sweeps prose, UI copy, code, and commit text for the patterns that mark output as machine-generated.
Standalone: this skill references no other FORGE skill.

## Activation receipt

Standing rule for the rest of this session, every turn, not just the first:

Whenever this skill's guidance shapes your response, end the reply with exactly one line, after a blank
line, as the last thing in the visible output:

    [skills: name1 > name2]

List every skill that fired this turn, FORGE or not, in the order it fired, by its full name. If this skill
ran alone, write `[skills: webforge-noslop only]`. If a skill you intended to call was not on disk, add one
short parenthetical: `[skills: webforge-noslop (<missing-skill> absent)]`.

Never write a second such line, a heading above it, a banner, or any explanation of it. Never put it inside a
code fence. This line is the only permitted trace of the machinery; everything else about phases, defect
logs, and refinement cycles stays hidden.

Exempt this receipt line from every anti-slop sweep; it is a log line, not prose.

## Thresholds, all falsifiable

| Rule | Threshold |
|---|---|
| Em dashes in generated prose or comments | zero |
| Banned-pattern density | more than 1 hit in any 150-word stretch fails |
| Final pass | cut 10 percent of the words |
| Function parameter unused by every current call site | fails |
| `catch` or `except` with no comment naming the specific failure it exists for | fails |
| Config key with exactly one call site and no documented plan to vary it | fails; it is a constant |
| Exported symbol with zero call sites and zero tests referencing it | fails; it is dead code |
| Emoji in commit message, PR description, code, or UI | zero |
| Commit or PR first line | imperative mood, stands alone, plus an explicit line naming what was not done |

The density threshold is the real gate. Humans use these words too; the tell is concentration, not presence.

## Prose sweep

Run in this order. Each pass is a different reader.

1. **Point pass.** State the one sentence this text exists to deliver, the audience, and the target length.
   If you cannot, the text is not ready to edit.
2. **Structure pass.** Pick a delivery shape on purpose: BLUF when the reader must act; inverted pyramid when
   they skim for facts; nut graf when they must be earned; SCQA when they must be persuaded; XYZ for bullets
   scanned in six seconds.
3. **Slop hunt.** Not a skim. Every hit gets rewritten with something more specific. The full list is in
   `references/banned-patterns.md`.
4. **Rhythm pass.** Vary sentence and paragraph length. Kill repeated openers. Three consecutive sentences of
   similar length reads as machine cadence.
5. **Hostile editor pass.** Read it as someone who does not want to be there. Then cut 10 percent.

Two ways to fail while de-slopping, both common:

- **Overcorrecting into fake-casual.** "Look, here's the thing" is a different flavor of the same problem.
- **Sanding off all confidence.** A genuine uncertainty gets stated once, plainly, not wrapped in "may
  potentially help to possibly improve".

## The constructions that survive vocabulary swaps

These are the deep tells. Changing the words does not remove them.

| Construction | Example | Fix |
|---|---|---|
| Negative parallelism | "It's not a framework, it's a philosophy." | State the claim directly |
| Participial tail | "Sales rose 12%, highlighting the strategy's success." | Two sentences, or drop the editorial |
| Rule of three | "fast, flexible, and powerful" | One specific claim with a number |
| Vague attribution | "experts say", "studies show" | Name the source or drop the claim |
| Equivocation seesaw | "While X presents challenges, it also offers opportunities." | Pick a side or state the real tradeoff |
| Setup sentence | "This raises an important question." | Ask the question |
| Elegant variation | rotating synonyms to avoid repeating a word | Repeat the word |

## UI copy

| Surface | Tell | Fix |
|---|---|---|
| CTA button | "Get Started Now!", "Unlock Your Potential", "Supercharge Your Workflow" | Imperative verb plus object: "Create project", "Export CSV", "Connect GitHub" |
| Empty state | "Looks like it's a little quiet here! Whether you're just getting started or..." | "No projects yet. Create one." plus the button |
| Error | "Oops! Something went wrong on our end. Please try again!" | Name the failure and the fix: "Upload failed: file exceeds 25 MB." |
| Onboarding | "Whether you're a beginner or a pro, our seamless onboarding will empower you to..." | One sentence, the actual first step |
| Landing copy | "Revolutionize the way you X", triads of adjectives | One real number or named capability: "Cut deploy time from 40 minutes to 90 seconds" |
| Toast | "Success! Your changes have been saved seamlessly." | "Saved." |

A button label is an imperative verb phrase, never a slogan. A toast is the one surface where the shortest
possible sentence is unambiguously correct.

## Code sweep

AI-generated code is simultaneously **over-defensive in style** and **under-defensive in substance**: broad
try/catch everywhere, and real security and edge-case gaps behind them. Check for both.

| Tell | Fix |
|---|---|
| Needless abstraction, premature interface | One implementation, no interface, until a second real call site exists. An abstract base with exactly one concrete implementation in the same diff is the grep-able signature |
| `try/catch` around everything | Catch specific types, only at a boundary that can act on the failure: retry, user message, rollback. Everything else propagates and crashes loud. Never a bare catch with a silent empty block |
| Comment restating the line below | Comment why, never what. `// increment counter` above `i += 1` is dead weight; `// retry budget: the server drops about 1 in 20 under load` earns its place |
| Over-parameterised function | Ship the parameters the current call site needs. Add one when a second caller needs a different value |
| Config key nothing configures | One call site and no plan to vary it means it is a constant |
| Verbose identifiers that add nothing | `userAccountInformationObject` becomes `account`. Keep length only where it buys precision |
| Dead compatibility shim | Delete it. A public API shim needs a deprecation date and a tracked removal, not indefinite life |
| Unrequested README, CONTRIBUTING, or CHANGELOG | Do not create documentation files unless asked, and do not add unrequested sections to an existing one |
| Emoji in commit messages | Zero. Attribution trailer if the harness requires one, nothing decorative |
| Sycophantic PR description | State the strongest objection to the change, what you did not do, and what is still unverified |

Any generated claim about what code does needs a `[VERIFIED: ran it]` or `[unverified]` tag. Confident prose
about behavior nobody executed is the code equivalent of a fabricated citation.

## Commit and PR text

First line: a complete sentence in imperative mood that stands alone as a summary. Then a blank line. Then the
problem being solved, why this approach, and explicitly any shortcomings.

Never write a first line like: "Fix bug." "Fix build." "Add patch." "Moving code from A to B." "Phase 1."
"Add convenience functions."

Size discipline: about 100 lines is a reasonable change, 1,000 lines is usually too large, and file spread
matters more than line count. 200 lines in one file is fine; the same 200 lines across 50 files usually is
not. A whole-file deletion counts as roughly one line of change.

## Quality checklist

- [ ] Zero em dashes in everything produced this turn, receipt line excluded.
- [ ] No 150-word stretch contains more than one banned-pattern hit.
- [ ] The final pass cut roughly 10 percent.
- [ ] Every `catch` block names the failure it exists for, in a comment.
- [ ] Every function parameter has a current call site that varies it.
- [ ] Every exported symbol has a call site or a test.
- [ ] No documentation file was created without being asked for.
- [ ] The commit first line is imperative, stands alone, and carries no emoji.
- [ ] The change description names at least one thing that was not done.

## Interop

Defer to a project-local writing, style-guide, or copy skill when one exists, and compose with it: it owns
voice and terminology, this skill owns the tell sweep. Name it in the receipt line. This skill needs nothing
else installed; if the rest of the pack is absent it runs standalone and says so in the receipt.

## Reference files

| File | Read when |
|---|---|
| `references/banned-patterns.md` | Running the slop hunt, or a specific pattern needs its replacement |
