# Banned patterns

The gate is density, not presence. More than one hit in any 150-word stretch fails. Humans use some of these
words; concentration is the tell.

## Contents
1. Words
2. Openers, filler, closers
3. Sentence constructions
4. Structural habits
5. Tone failures
6. Punctuation
7. Code-level patterns
8. Why this list is not aesthetic preference

---

## 1. Words

delve, leverage, foster, robust, seamless, vibrant, crucial, tapestry, realm, testament, myriad, synergy,
stakeholders, holistic, nuanced, multifaceted, underscore, showcase, garner, grapple, notably, comprehensive,
invaluable, meticulous, intricate, pivotal, landscape (figurative), journey (figurative), unlock, empower,
elevate, streamline, supercharge, revolutionize, world-class, cutting-edge, game-changing, best-in-class,
harness, embark, navigate (figurative), ever-evolving, dynamic (as filler), transformative.

The fix is never a synonym. The fix is the specific noun or verb for the thing itself. "Leverage the API"
becomes "call the API". "Robust error handling" becomes "retries on 429 and 503, gives up after 3 attempts".

## 2. Openers, filler, closers

**Openers:** "In today's fast-paced world", "In the ever-evolving landscape of", "Imagine a world where",
"Have you ever wondered", "As we navigate", "At its core", "Let's dive in", "Let's explore".

**Mid-text filler:** "It's important to note that", "It's worth mentioning", "That said", "Needless to say",
"When it comes to", "In order to" (use "to"), "The fact of the matter is", "At the end of the day".

**Closers:** "In conclusion", "To sum up", "Ultimately", "In summary", "The bottom line is", "Only time will
tell", "One thing is certain".

An opener that could precede any text on any subject is throat-clearing. Delete it and start at the first true
interesting thing.

## 3. Sentence constructions

These survive vocabulary swaps and are the deepest tells.

| Construction | Example | Replacement |
|---|---|---|
| Negative parallelism | "It's not a tool, it's a platform." | State the claim once, directly |
| Participial tail | "Revenue grew 12%, highlighting the strategy's success." | Split into two sentences, or cut the editorial half |
| Rule of three | "fast, flexible, and powerful" | One claim with a number behind it |
| Vague attribution | "experts say", "studies show", "many believe" | Name the source or drop the claim |
| Equivocation seesaw | "While X presents challenges, it also offers opportunities." | Say which one, and why |
| Setup sentence | "This raises an important question." | Ask the question |
| Elegant variation | "the API... the interface... the endpoint..." for one thing | Repeat the same word |
| Mirroring the prompt | restating the request as the first sentence of the answer | Start with the answer |
| False precision hedge | "may potentially help to possibly improve" | Hedge once, plainly, or not at all |

## 4. Structural habits

- Uniform paragraph lengths. Real writing varies.
- Bullet points used inside prose where sentences belong.
- Bold-term-colon lists: "**Speed:** it is fast. **Cost:** it is cheap."
- Header mania: a heading every two paragraphs.
- A summary section that repeats what was just said.
- Numbered "1 - 2 - 3" scaffolding imposed on content that has no sequence.
- Tables with one meaningful column and two filler ones.

## 5. Tone failures

- Puffery about the subject or the work.
- Uniform politeness with no variation in register.
- Scripted empathy: "I understand this can be frustrating."
- False-authority triple hedging.
- LinkedIn voice: short punchy fragments. Stacked. For emphasis.
- Congratulating the reader for their question or their idea.

## 6. Punctuation

| Mark | Budget |
|---|---|
| Em dash | zero. Currently the single most recognized tell |
| En dash used as an em dash | zero |
| Exclamation point in product copy | zero, except a genuine one-word interjection nobody will write anyway |
| Semicolon in UI copy | avoid; use two sentences |
| Ellipsis for trailing-off tone | zero |
| Emoji anywhere in code, commits, or product UI | zero |

Replacements for the em dash: a period, a colon when what follows explains what precedes, a comma for a light
aside, parentheses for a true aside.

## 7. Code-level patterns

| Pattern | Check | Fix |
|---|---|---|
| Speculative generality | an interface, protocol, or abstract base with exactly one implementation in the diff | Inline it. Add the abstraction at the second real call site |
| Blanket exception handling | a `catch` block with no comment naming its failure, or an empty body | Catch specific types at a boundary that can act. Let the rest crash loud |
| Restating comment | the comment and the line say the same thing | Delete the comment, or replace it with the reason |
| Unused parameter | no current call site varies it | Remove it |
| Phantom config | one call site, no plan to vary | Make it a constant |
| Dead export | no call site, no test | Delete it |
| Compatibility shim | preserved "just in case" with nothing calling it | Delete it, or give it a deprecation date and a tracked removal |
| Over-long identifier | length without precision | Shorten. Keep length only where it disambiguates |
| Unrequested docs | README, CONTRIBUTING, CHANGELOG nobody asked for | Do not create them |
| Sycophantic PR text | praise for the change | Name the strongest objection and what was not done |

Two claims coexist in the evidence and both belong here: AI code is stylistically over-defensive (broad
try/except, excess null checks) and substantively under-defensive (real security and edge-case gaps). One
study of generated snippets found roughly 40 percent contained a MITRE CWE Top-25 class vulnerability despite
the defensive-looking style. Do not let a wall of error handling stand in for a threat model.

Related measured pattern: AI-assisted repositories show code churn (lines reverted or rewritten within two
weeks) roughly doubling against a pre-AI baseline, refactoring's share of all changes falling from about 25
percent to under 10 percent, and duplication rising about 4x. The practical implication is that generated code
accretes rather than consolidates. When adding to a file, look first for the thing that already does this.

## 8. Why this list is not aesthetic preference

A study of over 15 million biomedical abstracts found an abrupt, discipline-crossing spike in exactly these
words after late 2022, larger than the effect of any contemporaneous world event, with at least 13.5 percent
of 2024 abstracts carrying the signature and up to 40 percent in some subfields. Reported fold-increases
include "delves" at about 28x, "underscores" at about 13.8x, and "showcasing" at about 10.7x, alongside a
291-word excess-style list that overlaps almost one-to-one with the word list above.

That is measurement by a different method reaching the same list. Treat the list as a fingerprint, not a
style guide.
