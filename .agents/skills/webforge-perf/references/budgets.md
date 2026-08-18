# Performance budgets and regression gates

## Contents
1. What makes a budget a budget
2. Numbers to budget against
3. Lighthouse CI
4. size-limit
5. k6 for API latency
6. Reading the Lighthouse score
7. Per-route First Load JS
8. Choosing the throttling profile
9. Field measurement wiring

---

## 1. What makes a budget a budget

A budget is a number that fails a build. A number in a document that nobody enforces is a wish. Three
properties:

1. It has a value and a unit.
2. A command checks it and exits non-zero when breached.
3. That command runs on every change, not on request.

## 2. Numbers to budget against

| Thing | Budget | Source of the number |
|---|---|---|
| LCP | 2.5s at p75 | Core Web Vitals good threshold |
| INP | 200ms at p75 | Core Web Vitals good threshold |
| CLS | 0.1 at p75 | Core Web Vitals good threshold |
| TTFB | 0.8s | diagnostic threshold, roughly 40 percent of the LCP budget |
| Compressed JS, 3s TTI on mid-tier Android | 365 KiB | the widely cited mobile interactivity budget |
| Compressed JS, 5s TTI | 650 KiB | same |
| TBT | under 200ms | lab proxy for INP |

Reference medians of the real web, which are the bar to beat rather than a target: 2,164 KB total mobile page,
632 KB JavaScript, 911 KB images, 122 KB fonts, 77 KB CSS, 72 requests. Year over year, median page weight
grew about 8 percent while image request counts fell 6 percent, so formats improved and payloads still grew.

Request count matters much less than it did under HTTP/1.1 because of multiplexing. The actionable lever is
**critical-path chain depth**: how many sequential round trips happen before the LCP resource starts
downloading. Do not chase a request-count number for its own sake.

## 3. Lighthouse CI

`lighthouserc.json`:

```json
{
  "ci": {
    "collect": { "numberOfRuns": 5, "startServerCommand": "npm run start" },
    "assert": {
      "preset": "lighthouse:recommended",
      "assertions": {
        "largest-contentful-paint": ["error", {"maxNumericValue": 2500}],
        "cumulative-layout-shift":  ["error", {"maxNumericValue": 0.1}],
        "total-blocking-time":      ["error", {"maxNumericValue": 200}],
        "total-byte-weight":        ["error", {"maxNumericValue": 2000000}],
        "categories:performance":   ["warn",  {"minScore": 0.9}]
      }
    }
  }
}
```

```bash
npm install -g @lhci/cli && lhci autorun
```

- Assertion levels: `error` fails the build, `warn` logs, `off` disables.
- `minScore` for 0-to-1 category scores; `maxNumericValue` for milliseconds and bytes.
- `numberOfRuns` of 5 or more with median aggregation. A single run is noise: CPU scheduling, thermal state,
  and background processes all move the number.
- `budget.json` sizes are in **KB**; inline assertion sizes are in **bytes**. Mixing the units silently
  produces a budget 1,000x off.

## 4. size-limit

```json
"size-limit": [
  { "path": "dist/app-*.js", "limit": "35 kB" },
  { "path": "dist/vendor-*.js", "limit": "120 kB" }
]
```

```bash
npx size-limit
```

Non-zero exit when over. A time-based limit (`"limit": "500 ms"`) measures download plus parse plus execute
and is the more meaningful budget when the question is interactivity rather than transfer cost.

## 5. k6 for API latency

```js
import http from 'k6/http'
export const options = { thresholds: { http_req_duration: ['p(95)<200'] } }
export default function () { http.get('https://api.example.com/endpoint') }
```

```bash
k6 run script.js
```

Non-zero exit on threshold breach, so it is a CI failure by construction.

## 6. Reading the Lighthouse score

Each metric's raw value is placed on a log-normal curve fitted to real HTTP Archive data: the 25th percentile
of real sites maps to a metric score of 50, and the 8th percentile maps to 90. The final score is a weighted
sum:

| Metric | Weight |
|---|---|
| TBT | 30 percent |
| LCP | 25 percent |
| CLS | 25 percent |
| FCP | 10 percent |
| Speed Index | 10 percent |

Consequence: **TBT moves the score more than LCP does.** If a Lighthouse score dropped and the cause is not
obvious, look at long tasks before looking at images.

The score is a lab composite. It is a useful regression detector and a poor description of user experience.
Never present it as a quality number on its own.

## 7. Per-route First Load JS

`next build` prints per-route First Load JS. That table is the cheapest budget signal available and needs no
extra tooling.

```
Route (app)                    Size     First Load JS
/                              1.2 kB          98.7 kB
/dashboard                    12.4 kB         184.2 kB
```

Watch the shared chunk. A jump in shared First Load JS across every route means something was imported into a
layout or a root-level module, which is the most common accidental bundle regression in an App Router app.

## 8. Choosing the throttling profile

| Tier | CPU | Network | Reference device class | Slowdown vs a dev machine |
|---|---|---|---|---|
| Mid-tier | 4x | slow 4G | mid-range Android, 6 to 8 GB RAM, around 450 USD | about 2.9x |
| Low-tier | 6x | slow 3G | budget Android, 4 to 8 GB RAM, around 199 USD | about 9.1x |

Lighthouse's default mobile profile: 150ms RTT, 1.6 Mbps down, 750 Kbps up, 0 percent packet loss, constant 4x
CPU. Lighthouse calls this roughly the bottom quarter of 4G and the top quarter of 3G.

Lighthouse uses **simulated** throttling by default: it replays one unthrottled trace through a network and
CPU model, which is fast and consistent and inherently approximate. DevTools and WebPageTest use **applied**
throttling, which actually interrupts execution. Numbers from the two are not comparable. Say which produced
any number you quote.

## 9. Field measurement wiring

```ts
import { onCLS, onINP, onLCP, onTTFB } from 'web-vitals/attribution'

function send(metric) {
  navigator.sendBeacon('/analytics', JSON.stringify({
    name: metric.name,
    value: metric.value,
    id: metric.id,
    target: metric.attribution?.element ?? metric.attribution?.interactionTarget,
  }))
}

onLCP(send); onINP(send); onCLS(send); onTTFB(send)
```

The attribution build adds roughly 1.5 KB brotli'd and identifies which element or which sub-part produced the
value. Use it while debugging; the standard build is enough for plain monitoring.

CrUX eligibility and lag, which decide how to read a dashboard: opted-in Chrome users with usage statistics
and synced history, on public indexable pages that are sufficiently popular; a rolling 28-day window;
aggregated at p75 per metric per URL or origin. A pass or fail there always lags reality by up to 28 days.
