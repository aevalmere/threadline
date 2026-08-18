# ROADMAP.md — Threadline

**Source of truth for sequencing.** `SPEC.md` owns schema and behavior.

**Ship: August 31, 2026 — non-negotiable.**

One phase at a time. **A phase starts only after the user approves the previous gate.** One item in flight at a time. Every gate ends with a manual verification checklist the user runs in production.

> **Dates rebased 2026-08-09.** The original plan dated P0 as Aug 5–6; work actually began Aug 9. Every phase, gate, and the ship date are unchanged — the three days came out of slack, not scope. Original dates in parentheses.

---

## P0 — Foundation · Aug 9 *(orig. Aug 5–6)*

- [x] Repo scaffold — Vite / React / TS, Tailwind, shadcn, ESLint, Vitest
- [x] App shell — sidebar (Channels / Forums / Docs / Tasks), ⌘K placeholder
- [x] Supabase project wired via CLI migrations — `profiles`, `channels`, `channel_members`, `messages`
- [x] Magic-link auth, public signups disabled
- [x] Seed script — 2 users, 2 channels, 50 messages — plus the four-verb anon RLS check
- [x] GitHub → Cloudflare Pages auto-deploy — https://threadline-cc0.pages.dev
- [x] `.env` handling — `.env*` gitignored in the first commit, `.env.example` committed

**GATE G0** — The user opens the production URL **on phone and laptop**, receives a magic link, logs in, and sees the shell with the seeded channels.

---

## P1 — Chat · Aug 10–17 *(orig. Aug 7–13)*

> **Rebased again 2026-08-10.** The account system (DECISIONS #14) was added mid-phase on Ethan's call and is roughly a day and a half that was not budgeted. P1 now runs to **Aug 17** and P2 shifts to **Aug 18–20**, so the phases still do not overlap. The two days come out of the slack between P2 and P3, not out of scope. Ship date unchanged, and the pre-agreed fallbacks exist for exactly this.

- [x] Channel CRUD
- [x] Realtime messages with optimistic send
- [x] Threaded replies
- [x] Database guard for the one-level-deep thread rule — `flatten_thread_root` trigger *(pulled forward from BACKLOG on Ethan's call; DECISIONS #8)*
- [x] Uploads to Supabase Storage — 10 MB cap, inline image thumbnails
- [x] Member list panel *(added on Ethan's call — @mentions need a way to see who is mentionable)*
- [x] **Account system** — invite-code registration, username + password sign-in, profile editing *(added 2026-08-10 on Ethan's call; replaces magic links, DECISIONS #14)*
- [x] @mentions writing `notifications` rows *(keys on `username`, so it follows the account system)*
- [x] **Notification bell** — panel, mark-read, in-app toast, and a browser notification when the tab is hidden *(pulled forward from P5 on Ethan's call; DECISIONS #16)*
- [x] Unread badges via `last_read_message_id` *(batched writes — Non-negotiable 8; counting moved into SQL, DECISIONS #18)*
- [x] Reconnect-and-resync — `WHERE id > last_seen`, draining until caught up *(the stuck-"sending"-bubble gap is closed by `sweepPending`, which runs on join as well as on reconnect)*
- [x] Infinite-scroll pagination, 50/page *(keyset on `id`, scroll position preserved)*

**GATE G1** — Two browsers: message appears in <1s both directions · hard refresh mid-thread loses nothing · network killed 30s then restored resyncs missed messages · image upload renders a thumbnail · unread badges correct across both users.

> **Gate run 2026-08-18 — machine side PASS.** `npm run build`, `npm run lint`, `npm run test` (233 tests / 12 files) all exit 0. `npm run seed` ran green against live Supabase: 38/38 probes, covering the four-verb anon RLS check, storage signed-vs-public reads, `unread_counts()` clause by clause, notification kind/`read_at` constraints, username uniqueness/format/trigger, and signups-disabled. Reviewer subagent on the full phase diff (74 files, +12,582/−457) returned **PASS** with six non-blocking notes.
>
> **All five acceptance items need two browsers and a killed network, so none of them is PASS on Claude's authority** — they are the user's production checklist. The gate closes when Ethan runs it.

---

## P2 — Tasks · Aug 18–20 *(orig. Aug 14–16)*

- [ ] Task CRUD
- [ ] Kanban with dnd-kit — `position` float persistence
- [ ] Status / assignee / due date
- [ ] "My Tasks" view
- [ ] **Create task from message** — hover action → prefilled modal → task links back to source with jump navigation
- [ ] Vitest: task-from-message payload + `links` row creation

**GATE G2** — Convert a real message to a task · drag it across columns · refresh and the order holds · the task's "from #channel" link jumps to the exact message.

> **On G2 pass: TEAM BETA.** The user invites the whole team and daily chatter moves to Threadline. From here **real usage is the test suite** — triage team-reported bugs before new features every day.

---

## P3 — Forums · Aug 19–21 *(orig. Aug 17–19)*

- [ ] Forum-kind channels
- [ ] Posts with title + tags
- [ ] Comments reusing the `messages` machinery *(+ the deferred `messages.post_id` FK)*
- [ ] Tag filtering
- [ ] Create-task-from-post

**GATE G3** — Create a tagged post · comment on it · filter by tag · convert the post to a task.

---

## P4 — Docs · Aug 22–25 *(orig. Aug 20–23)*

- [ ] Collections tree
- [ ] BlockNote pages with debounced autosave (1s)
- [ ] Soft edit-lock — "someone is editing" banner with the editor's display name via `editing_heartbeat_at`, **no CRDT**
- [ ] Image upload into pages
- [ ] Insert-link-to-task/message inside a page
- [ ] "Linked items" backlink panel on pages and tasks

**GATE G4** — Two users: the second sees the editing warning · images persist · a page links to a task and the task shows the page under Linked items.

---

## P5 — Search & notifications · Aug 26–27 *(orig. Aug 24–25)*

- [ ] ⌘K unified search calling `search_all` — grouped results, jump-to-entity
- [ ] `search_tsv` + GIN on `posts`, `pages`, `tasks` *(`messages` already has it from P0)*
- [x] ~~In-app notification bell — mentions, assignments, replies — with mark-read~~ **shipped in P1** (DECISIONS #16). What remains here: `assignment` notifications, which need P2's `tasks` table.
- [ ] Vitest: search query builder

**GATE G5** — One search box finds a phrase from a week-old chat message, a task by title, and a doc by heading text · bell shows a mention within seconds.

---

## P6 — Harden & ship · Aug 28–31 *(orig. Aug 26–31)*

- [ ] Team bug-bash fixes — **priority over everything**
- [ ] Data-export button — authenticated JSON dump of all content tables. **Day-one insurance, do not skip**
- [ ] Dependency freeze — Aug 28
- [ ] Clean-environment redeploy rehearsal — Aug 30
- [ ] Timeboxed polish
- [ ] **SHIP — Aug 31**

**Stretch — only if the bug-bash is quiet by Aug 30.** These two are the *only* items allowed to jump the backlog:
- [ ] DMs as private 2-person channels *(near-zero new infra on this schema)*
- [ ] Emoji reactions *(one join table)*

---

## Never-break test paths

These run in **every** gate. Added at the phase that creates the code:

| Test | Phase added |
|---|---|
| Unread-count calculation | P0 → moved to `scripts/seed.ts` in P1 (DECISIONS #18) — asserted against `unread_counts()` clause by clause, not a unit test |
| Message pagination / resync query | P0 |
| Task-from-message payload + link creation | P2 |
| Search query builder | P5 |

No coverage theater beyond these.
