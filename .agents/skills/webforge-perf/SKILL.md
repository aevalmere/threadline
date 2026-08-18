---
name: webforge-perf
description: >-
  Refuses web performance work until a before-number exists from a named tool at a named percentile, then fixes
  the one phase that number points at: LCP sub-parts, INP input delay or processing or presentation, CLS
  sources, bundle bytes, or query time. Use for "make it faster", "it feels slow", a failing Lighthouse or Core
  Web Vitals check, or a bundle-size regression. Use this even when the user does not name it. Not for adding
  features.
metadata:
  pack: webforge
  kind: perf
  domain: frontend,performance
  version: "1.0.0"
---

# WebForge Perf
Measure, name the phase, fix that phase, gate the fix. Standalone: this skill references no other FORGE skill
and works with the rest of the pack absent.

## Activation receipt

Standing rule for the rest of this session, every turn, not just the first:

Whenever this skill's guidance shapes your response, end the reply with exactly one line, after a blank
line, as the last thing in the visible output:

    [skills: name1 > name2]

List every skill that fired this turn, FORGE or not, in the order it fired, by its full name. If this skill
ran alone, write `[skills: webforge-perf only]`. If a skill you intended to call was not on disk, add one
short parenthetical: `[skills: webforge-perf (<missing-skill> absent)]`.

Never write a second such line, a heading above it, a banner, or any explanation of it. Never put it inside a
code fence. This line is the only permitted trace of the machinery; everything else about phases, defect
logs, and refinement cycles stays hidden.

## The gate, before any optimization code is written

Every box must be checked. If any is unchecked, the next action is measurement, not code.

- [ ] I have a BEFORE number, from a named tool, at a named percentile or condition.
- [ ] The subsystem I am about to touch is actually over its budget, rather than just feeling slow.
- [ ] I can name the exact phase this change targets: LCP resource load delay, INP processing duration, CLS
      from a specific unsized element, query planning time. If I cannot name it, diagnosis is not finished.
- [ ] If this adds a cache: the TTL, the invalidation trigger, and the blast radius of a wrong invalidation
      are written down.
- [ ] If this touches a query or index: I have a before-and-after `EXPLAIN (ANALYZE, BUFFERS)` pair.
- [ ] This change ships with a regression gate, so it cannot silently regress again.

Two claims this skill never makes:

1. "It is faster" without either a p75 field number or a median of at least 5 lab runs. A single Lighthouse
   run varies with CPU scheduling, thermal state, and background tabs. One run is an anecdote.
2. "It feels slow" as a ticket. That is a symptom report, and the first response to it is a measurement, not
   a refactor.

## Thresholds

| Metric | Good | Needs improvement | Poor | Measured at |
|---|---|---|---|---|
| LCP | 2.5s or less | 2.5 to 4.0s | over 4.0s | p75, mobile and desktop separately |
| INP | 200ms or less | 200 to 500ms | over 500ms | p75 |
| CLS | 0.1 or less | 0.1 to 0.25 | over 0.25 | p75 |
| TTFB | 0.8s or less | 0.8 to 1.8s | over 1.8s | diagnostic, a component of LCP |
| TBT | under 200ms | | | lab only, a proxy for INP |

TBT can flag a problem users never experience, because it measures blocking during a window in which nobody
interacted. When TBT and field INP disagree, field INP wins.

## Name the phase before writing code

**LCP splits into four sub-parts** with a target share of the total:

| Sub-part | Target share | If it is fat |
|---|---|---|
| TTFB | around 40 percent | Server or network. Look at origin response time, redirects, and cold starts |
| Resource load delay | under 10 percent | The LCP resource is discovered late: missing `fetchpriority`, missing preload, or injected by JS instead of present in the HTML |
| Resource load duration | around 40 percent | The resource itself is too big or served badly: format, compression, CDN |
| Element render delay | under 10 percent | Something sits between resource-ready and paint: render-blocking CSS or JS, or client-side rendering |

**INP splits into three phases:**

1. **Input delay** - the main thread was busy when the interaction arrived. Break long tasks into smaller ones
   and yield between chunks.
2. **Processing duration** - the handler itself. Do only the render-critical update synchronously; defer word
   counts, autosave, and analytics to a later task.
3. **Presentation delay** - style recalculation, layout, or paint after the handler. Reduce DOM size and
   complexity under the changed subtree, and stop layout thrashing.

**CLS** is `impact fraction x distance fraction`, grouped into session windows (shifts under 1s apart group;
a window caps at 5s), and reported as the single largest burst, not the sum. Shifts within 500ms of user input
are excluded, which is the sanctioned way to let an expand or "load more" move content without penalty.

Fixes: set `width` and `height` (or `aspect-ratio`) on every image and video; reserve space for ads and embeds
with `min-height`; inject dynamic content below existing content, never above; use `next/font` or
`font-display: optional` with `size-adjust` to avoid font-swap shift.

## Budgets

| Budget | Number |
|---|---|
| JS for 3s time-to-interactive on a mid-tier Android | 365 KiB compressed |
| JS for 5s time-to-interactive | 650 KiB compressed |

The load-bearing fact behind those numbers, more durable than the numbers themselves: **JavaScript costs at
least 3x more per byte than any other asset type**, because JS bytes cost parse, compile, and execute time on
the CPU, not just download time. On mid-tier hardware the bottleneck is CPU, not network; such a device runs
at roughly 15 to 25 percent of a typical developer machine's speed.

Real-world medians, useful only as the bar to clear rather than a target: median mobile page 2,164 KB total,
632 KB of it JavaScript, 911 KB images, 72 requests. If a proposed budget is worse than that, it is not a
budget.

Throttle to a real profile before believing a local number:

| Tier | CPU throttle | Network | Real-world slowdown vs a dev machine |
|---|---|---|---|
| Mid-tier | 4x | slow 4G | about 2.9x |
| Low-tier | 6x | slow 3G | about 9.1x |

Lighthouse's own default mobile profile is 150ms RTT, 1.6 Mbps down, 750 Kbps up, constant 4x CPU, using
simulated throttling rather than applied throttling. Know which kind produced a number before comparing it
against another tool's number.

## Field versus lab

| | Field (CrUX, your own RUM) | Lab (Lighthouse, DevTools) |
|---|---|---|
| Reflects | real devices, real networks, real interactions | one simulated profile |
| Authoritative for | actual user experience | catching regressions pre-merge |
| Can be gamed by testing on your fast machine | no | yes, silently |

CrUX aggregates a rolling 28 days at p75, so a fix shipped today does not move that dashboard for weeks. Use
lab data and your own RUM for same-day feedback; use CrUX for the ground-truth trend.

## Commands

```bash
npx @lhci/cli autorun                      # budgets as a CI gate, numberOfRuns >= 5 with median aggregation
npx size-limit                             # bundle byte or parse-time budget, non-zero exit on breach
npx next build                             # per-route First Load JS, printed by the build
ANALYZE=true npx next build                # bundle treemap, after wrapping next.config with
                                           # withBundleAnalyzer from @next/bundle-analyzer
```

```ts
import { onCLS, onINP, onLCP } from 'web-vitals/attribution'
// the attribution build adds metric.attribution: which element and which sub-part caused the value.
// ~1.5 KB larger brotli'd. Worth it while debugging, not needed for plain monitoring.
```

Postgres, when the phase is query time:

```sql
EXPLAIN (ANALYZE, BUFFERS) <query>;
BEGIN; EXPLAIN ANALYZE DELETE FROM big_table WHERE cond; ROLLBACK;   -- safe on a mutating statement
```

## Web-specific levers, by phase

- **LCP render delay**: push `'use client'` down to leaves so less of the tree hydrates; `priority` on the
  actual LCP image and on nothing else; `next/font` to remove the external request and the swap shift.
- **INP processing**: the React Compiler (stable, opt-in via `reactCompiler: true`) memoizes automatically and
  removes most manual `useMemo`/`useCallback`. It adds a Babel pass and real build time; enable it
  deliberately on a performance-sensitive app, not by default on every scaffold.
- **Bundle bytes**: `lazy(() => import('...'))` at module scope, never inside a component body; audit the
  largest three modules in the analyzer before optimizing anything else.
- **Transfer**: hashed static assets get `Cache-Control: public, max-age=31536000, immutable`. HTML gets
  `no-cache`, which means revalidate before use, not "do not store".

## Attributing a regression

1. Confirm it is real, not noise: a median of 5 or more lab runs, or a p75 field movement.
2. Bisect by deploy, re-running the same assertion at each candidate commit rather than eyeballing new manual
   tests.
3. Capture a trace on the last-good and first-bad commit under identical throttling and diff the flame chart,
   long-task list, LCP candidate element, and request waterfall.
4. Attribute to a phase using the LCP four-way or INP three-way split, then find the specific line.
5. Encode the fix as a CI assertion before closing it out. A fixed regression with no new gate is a regression
   that will happen again.

## Quality checklist

- [ ] A BEFORE number is quoted, with the tool and the condition that produced it.
- [ ] The targeted phase is named in one clause before any code changed.
- [ ] The AFTER number came from the same tool under the same conditions as the BEFORE number.
- [ ] Any "faster" claim rests on a p75 field number or a median of at least 5 lab runs.
- [ ] A regression gate exists and its command is written down.
- [ ] Any new cache states its TTL, its invalidation trigger, and its blast radius.
- [ ] Any query or index change shows a before-and-after `EXPLAIN ANALYZE` pair.

## Interop

Defer to a project-local performance, monitoring, or infrastructure skill when one exists, and compose with
it: it owns the budgets and the dashboards, this skill owns the diagnosis discipline. Name it in the receipt
line. This skill needs nothing else installed; if the rest of the pack is absent it runs standalone and says
so in the receipt.

## Reference files

| File | Read when |
|---|---|
| `references/budgets.md` | Setting or enforcing a budget, or wiring a regression gate |
