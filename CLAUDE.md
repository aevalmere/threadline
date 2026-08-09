# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## What Threadline is

A team's discussion-to-action hub, where every thread keeps its through-line from chat to task to doc. Internal platform for one small trusted team (5–30 people). Discord + Notion + Linear lite, merged:

- Realtime chat — channels, threaded replies, image/file uploads, @mentions, unread badges
- Forum posts — title + tags, threaded comments
- Notion-lite doc pages — block editor, organized in collections
- Tasks — status / assignee / due date, kanban board, **create task from message**
- One unified search box across messages, posts, pages, tasks
- Lightweight links between entities (task shows "from #channel", doc links to task)

**The core flow is discussion → task → doc without losing context. Every phase serves that flow.** "Create task from message" is the feature that justifies the whole app.

**Ship date: August 31, 2026 — non-negotiable.**

Optimize every decision for: **shipping on time > low maintenance > $0/mo hosting > everything else.** When two options are close, pick the boring one with more training-data precedent.

## Non-goals — hard NO for v1

No billing. No roles/permissions (one trusted workspace; auth is the only wall). No native mobile apps (responsive web only). No voice/video. No collaborative co-editing (no Yjs/CRDT). No email digests or push notifications (in-app bell only). No read receipts, edit history, custom emoji, per-channel notification prefs, kanban automations, backlink graph visualization, or external search service.

**If the user asks for any of these mid-build: remind them of the ship date and append it to `BACKLOG.md` instead.**

## Locked stack — never swap, never "improve"

| Concern | Choice | Why it is locked |
|---|---|---|
| App | **Vite + React + TypeScript SPA** with react-router | No SSR framework, no Next.js. The entire backend is Supabase; a static SPA deploys to Cloudflare Pages free with no ToS issues and removes the server/client-component confusion class of bugs. |
| Backend | **Supabase** — Postgres, Auth, Realtime (Broadcast / Presence / Postgres Changes), Storage | One `supabase/` folder, CLI-managed migrations from day one. |
| Auth | **Magic links.** Public signups DISABLED | User invites teammates from the Supabase dashboard. Supabase built-in email first; switch to Resend SMTP only if rate limits bite. |
| UI | **shadcn/ui + Tailwind** | Scaffold chat surfaces from shadcn's chat components; don't hand-roll message lists from scratch. |
| Rich text | **BlockNote** (free core only — **never install XL packages**) | Doc pages and rich task descriptions. |
| Kanban DnD | **dnd-kit** | react-beautiful-dnd is dead and forbidden. |
| Search | **Postgres full-text search** — generated `tsvector` columns + GIN indexes + one `search_all(q)` SQL function that UNION ALLs across the four content tables | No Meilisearch, Typesense, Algolia, or Elasticsearch. |
| Hosting | **Cloudflare Pages**, auto-deploy from GitHub `main` | Production deploys from day one. |

## Non-negotiables

1. All realtime goes through supabase-js Realtime channels only. Never install socket.io, ws, Ably, Pusher, or any websocket server. If a feature seems to need one, the design is wrong — redesign around Broadcast/Presence/Postgres Changes.
2. RLS is ON for every table, with exactly one blanket policy per table: any authenticated user has full access. No per-row ownership policies, no policy mazes — we are a trusted team. The service_role key never appears in client code or the repo. Verify all four verbs (select/insert/update/delete) work through the anon client in the seed test.
3. Library locks are absolute (see LOCKED STACK). No swaps, no additions of overlapping libraries, no state-management framework unless a written entry in DECISIONS.md justifies it.
4. SPEC.md is the source of truth for schema and product behavior; ROADMAP.md for sequencing. Any deviation gets updated in the same commit that deviates. Never re-litigate a settled decision from memory — read the file.
5. Nothing is "done" on your say-so. Every task ends with a verifiable check: a passing test, a passing build, or a screenshot/manual-step list I can run. State the check explicitly when you claim completion.
6. Small diffs, frequent commits, conventional messages referencing the ROADMAP item. After two failed attempts at the same bug: stop, revert to last green commit, restate the problem in DECISIONS.md, and re-approach fresh. Never big-bang refactor. Never git push --force. Never edit or delete a migration that has already run in production — write a new one.
7. Risky diffs — anything touching schema/migrations, auth, or realtime — must be reviewed by the reviewer subagent (fresh context) and return PASS before merging. You never review your own risky work.
8. Debounce typing/presence broadcasts client-side (≥300ms) and batch unread updates — protect the free tier's realtime budget.
9. Secrets live in .env.local and platform env vars only. .env* is gitignored in the first commit.
10. Visual polish is timeboxed. I must give pixel-specific instructions or default styling stands. Never iterate on "make it feel better."

## Installed skills and MCP — and where they contradict this file

`.mcp.json` registers the **Supabase MCP server** (project `uuhgzpfrxttgjbondcos`, features: docs, account, database, debugging, development, functions, branching). `.agents/skills/` holds two vendored Supabase skills, junction-linked into `.claude/skills/` (junctions are gitignored; the content is committed, and `skills-lock.json` pins the hashes).

**These are third-party advice, not project rules. This file wins.** Two known conflicts:

1. **RLS.** `.agents/skills/supabase-postgres-best-practices/references/security-rls-basics.md` teaches per-row ownership policies — `using (user_id = auth.uid())` — and `force row level security`. That is **exactly what Non-negotiable 2 forbids.** Threadline is one trusted workspace with no roles; every table gets one blanket `for all to authenticated using (true) with check (true)` policy and nothing else. Do not "fix" a policy to match that skill. If a future session thinks the policies look too permissive, the answer is in Non-negotiable 2 and SPEC.md §2.2 — it is deliberate.
2. **Generic Postgres tuning.** The same skill's advice on indexing, pooling, and partitioning is written for larger systems. At 5–30 users, applying it is scope creep against the ship date. Read it when a real query is slow, not preemptively.

**Migrations stay CLI-managed and repo-owned.** `supabase/migrations/` is the source of truth. If the MCP's `apply_migration` is used, the version it records must match the repo filename exactly, or `supabase db push` will later try to re-apply. When in doubt, use `npx supabase db push`.

## Workflow loop — every task, every session

1. Pick the single next unchecked `ROADMAP.md` item (**one in flight at a time**). Restate it + its verification check.
2. **Plan first (plan mode) for anything touching schema, auth, or realtime.**
3. Implement the smallest vertical slice. Keep the diff small.
4. Verify per rule 5. Risky diff → reviewer subagent per rule 7.
5. Commit, tick `ROADMAP.md`, log any decision in `DECISIONS.md`. Then next item.
6. Between unrelated tasks, clear context — **state lives on disk, not in the conversation.**
7. Parallel work is allowed ONLY for items in the same phase touching disjoint files (e.g. P5 search vs. notification bell) via separate worktrees — otherwise strictly sequential. **When in doubt, sequential.**

## Pre-agreed fallbacks

Propose these calmly instead of heroics:

| If | Then |
|---|---|
| Docs slip | Ship P0–P3 + P5; team keeps current docs tool one month |
| Realtime misbehaves in prod | 3-second polling behind a feature flag (fine at 30 users) |
| Search slips | ILIKE now, FTS in September |
| Chat itself slips | Ship tasks + docs first; team stays on Discord for chat one month |

**Auth + deploy are never cut, never deferred.**

## File map

| File | Role |
|---|---|
| `CLAUDE.md` | This file — rules, stack, workflow loop |
| `SPEC.md` | **Source of truth** for schema and product behavior |
| `ROADMAP.md` | **Source of truth** for sequencing; phases, gates, checkboxes |
| `DECISIONS.md` | Append-only decision log. Never rewrite history here |
| `BACKLOG.md` | v1.1 parking lot. Everything deferred lands here |
| `.claude/agents/reviewer.md` | Adversarial read-only reviewer subagent |
| `.claude/commands/resume.md` | `/resume` — session start ritual |
| `.claude/commands/gate.md` | `/gate` — phase gate runner |
| `supabase/migrations/` | CLI-managed, append-only migrations |
| `scripts/seed.ts` | Seed data + the four-verb anon RLS check |
| `src/lib/` | supabase client, auth provider, pure tested helpers |
| `src/routes/` | One file per route |
| `src/components/layout/` | App shell, sidebar, command palette |

## Commands

```bash
npm run dev        # Vite dev server on http://localhost:5173
npm run build      # tsc -b && vite build  → dist/
npm run preview    # serve dist/ locally
npm run lint       # eslint
npm run test       # vitest run
npm run test -- src/test/unread.test.ts   # single test file
npm run seed       # seed data + four-verb anon RLS check (needs .env.local)

npx supabase migration new <name>   # create a migration file
npx supabase db push                # apply migrations to the linked project
```

## Environment quirks

**Node is not on PATH.** It lives at `C:\Program Files\nodejs` (v24.19.0, npm 11.17.0). Prefix every PowerShell command that needs it:

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"; npm run build
```

The Supabase CLI is a **devDependency**, not a global install — always `npx supabase …`.

`npx supabase login` and `npx supabase link` are interactive and secret-bearing: **the user runs them**, not Claude. Suggest they type `! npx supabase login` in the prompt so output lands in the conversation.

## What the user does (never Claude)

Creates the Supabase project and hands over URL + anon key · disables public signups · **sets Authentication → URL Configuration: Site URL plus Redirect URLs for both `https://<project>.pages.dev/**` and `http://localhost:5173/**`** (without the exact `/auth/callback` origin on the allowlist, magic links silently fall back to Site URL and dead-end) · connects the GitHub repo to Cloudflare Pages (Claude prints the exact clicks) · invites teammate emails from the Supabase dashboard · later if needed: custom domain, Resend SMTP.

**The user never hands over the service_role key for client work.** When blocked on the user, say so once and continue with unblocked items.
