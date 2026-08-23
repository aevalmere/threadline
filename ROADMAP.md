# ROADMAP.md — Threadline

**Source of truth for sequencing.** `SPEC.md` owns schema and behavior.

**Ship: August 31, 2026 — non-negotiable.**

One phase at a time. **A phase starts as soon as the previous gate's machine side passes** *(rewritten 2026-08-18, DECISIONS #21 — gates no longer wait on the user)*. Sessions take a whole batch — by default the rest of the phase — with bulk verification at batch end. Every gate still ends with a manual production checklist for the user, but it runs asynchronously: what it surfaces comes back as priority-one bugs; it does not hold the next phase. Still blocking: TEAM BETA entry at G2 and the G6 ship checks.

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

> **Gate run 2026-08-18 — machine side PASS.** `npm run build`, `npm run lint`, `npm run test` (233 tests / 12 files) all exit 0. The first build ran with `VITE_MOCK_BACKEND=true` still in `.env.local`, which tree-shakes supabase-js out entirely (411 kB); rebuilt against the real client it is **631 kB / 186 kB gzip**, over Vite's 500 kB warning line. Production was never affected — Cloudflare builds from GitHub and never sees `.env.local` — but judge bundle size only from a `false` build. `npm run seed` ran green against live Supabase: 38/38 probes, covering the four-verb anon RLS check, storage signed-vs-public reads, `unread_counts()` clause by clause, notification kind/`read_at` constraints, username uniqueness/format/trigger, and signups-disabled. Reviewer subagent on the full phase diff (74 files, +12,582/−457) returned **PASS** with six non-blocking notes.
>
> **All five acceptance items need two browsers and a killed network, so none of them is PASS on Claude's authority** — they are the user's production checklist. The gate closes when Ethan runs it.
>
> **Waiting on Ethan (2026-08-18), in order:**
> 1. **Run the G1 checklist** on https://threadline-cc0.pages.dev — two windows, one incognito, signing in as two different users. `npm run blast` produces the 250-message backlog step 6 needs; `npm run blast -- --clean` removes the rows afterwards.
> 2. **Delete the leftover `guest` auth user** — DECISIONS #13 dropped its policies but left the account, which still has a password and can sign in. It owns nothing, so nothing cascades. Dashboard → Authentication → Users → `guest@threadline.local` → Delete. Claude was blocked from doing this by the permission classifier, correctly; see DECISIONS #20.
> 3. **Confirm `VITE_MOCK_BACKEND` is not set in the Cloudflare Pages project.** It must be absent or `false` there — see DECISIONS #20 for why a mock build silently drops supabase-js.
>
> P2 does not start until item 1 passes.
>
> **Superseded 2026-08-18 — DECISIONS #21.** Under the batch workflow the machine-side PASS above unblocks P2 by itself. Items 1–3 stay open on Ethan's async checklist; anything item 1 surfaces is a priority-one bug, fixed before new P2 features.
>
> **2026-08-22 — item 1 run by Ethan: G1 clear.** His findings (edit affordances on others' messages, the jump flash scrolling away) were fixed same-day — DECISIONS #26. Items 2 and 3 remain open.

---

## P2 — Tasks · Aug 18–20 *(orig. Aug 14–16)*

- [x] Task CRUD
- [x] Kanban with dnd-kit — `position` float persistence
- [x] Status / assignee / due date
- [x] "My Tasks" view
- [x] **Create task from message** — hover action → prefilled modal → task links back to source with jump navigation *(jump now pages backwards for old messages — DECISIONS #23)*
- [x] Vitest: task-from-message payload + `links` row creation

**GATE G2** — Convert a real message to a task · drag it across columns · refresh and the order holds · the task's "from #channel" link jumps to the exact message.

> **Gate run 2026-08-18 — machine side PASS.** `npm run build` exit 0 (690.57 kB / 205.50 kB gzip — dnd-kit is the growth; warning stays un-silenced per DECISIONS #20), `npm run lint` exit 0, `npm run test` 271 tests / 13 files green, `npm run seed` 48/48 probes green against live Supabase including the eight new tasks/links probes and the planted-row anon denial. Migration reviewed pre-push (PASS), then a 25-agent adversarial review over the phase diff — seven confirmed findings, all fixed (DECISIONS #24) — then the binding batch reviewer: **PASS** with six non-blocking notes, two fixed in the gate commit.
>
> **All four acceptance items need a browser, so none is PASS on Claude's authority** — they are Ethan's production checklist below. `GATE G2 (machine): PASS`.
>
> **Ethan's G2 checklist** (~5 min on https://threadline-cc0.pages.dev, after the deploy finishes; two tasks exist by step 3, so make two):
> 1. In any channel, hover a message → the new checklist icon → **Create task**. Title comes prefilled; set **Assignee: you** and **Due: yesterday**; Create.
> 2. Open **Tasks** — the card is in *To do*, the due date is red, and it carries a **from #channel** chip.
> 3. Create a second task with **New task**, then **drag** the first card to *Doing*, then drop it **onto** the second card — it takes that card's place.
> 4. **Hard-refresh** — the order holds exactly.
> 5. Click the card's **from #channel** chip — the channel opens, scrolls to the exact message, and flashes it. (Deep version: `npm run blast` 250 messages first, then chip-jump across them; `npm run blast -- --clean` after.)
> 6. Open a card, change status with the **buttons** (the no-drag path), then **Delete → Confirm delete**.
> 7. **My tasks** tab lists what is assigned to you, due-date first.
>
> **Still open from G1 (async):** the G1 two-browser checklist · delete the `guest` auth user · confirm `VITE_MOCK_BACKEND` is unset in Cloudflare Pages.
>
> **2026-08-22 — checklist run by Ethan: G2 clear.** His asks (task descriptions on cards, creator-only field editing) shipped same-day — DECISIONS #26.

> **On G2 pass: TEAM BETA.** The user invites the whole team and daily chatter moves to Threadline. From here **real usage is the test suite** — triage team-reported bugs before new features every day. **Inviting the team is inherently Ethan's call — this handoff stays blocking (DECISIONS #21).**

---

## P3 — Forums · Aug 19–21 *(orig. Aug 17–19)*

- [x] Forum-kind channels
- [x] Posts with title + tags
- [x] Comments reusing the `messages` machinery *(+ the deferred `messages.post_id` FK, **and** the deferred `tasks.source_post_id` → `posts` FK — SPEC §2.3, noted in the P2 migration)*
- [x] Tag filtering
- [x] Create-task-from-post

**GATE G3** — Create a tagged post · comment on it · filter by tag · convert the post to a task.

> **Gate run 2026-08-22 — machine side PASS.** `npm run build` exit 0 (715.22 kB / 210.67 kB gzip — the forum/post surfaces are the growth; warning stays un-silenced per DECISIONS #20), `npm run lint` exit 0, `npm run test` 305 tests / 14 files green, `npm run seed` 63/63 probes green against live Supabase — including the fifteen new P3 probes: four verbs on posts/tags/post_tags, the one-parent CHECK (23514), both deferred FKs on their failure side (23503), the tags unique index (23505), comment/post_tag cascades on post delete, and planted-row anon denials for posts and tags. A scripted live probe replicated PostView's exact subscription (`post_id=eq.` filter, anon client with a real session) and received both INSERT and UPDATE — first run timed out on a cold project, exactly DECISIONS #20's warm-up trap, and passed on retry. Migration reviewed pre-push (PASS, six non-blocking notes). Batch reviewer over the whole phase diff (9 commits, 40 files, +3.8k/−1.1k): **FAIL** with two confirmed findings — comment-sourced tasks rendered no chip, and post deletion left links to cascaded comments dangling — both fixed in `cb533ab`, re-review **PASS** (DECISIONS #25).
>
> **All four acceptance items need a browser, so none is PASS on Claude's authority** — they are Ethan's checklist below. `GATE G3 (machine): PASS`.
>
> **Ethan's G3 checklist** (~5 min on https://threadline-cc0.pages.dev after the deploy finishes; the seed created forum **#ideas**):
> 1. Sidebar → Forums → **#ideas** → **New post**: give it a title, a body, and tags `bug, design` → Create. You land on the post; the tags render as dot-chips.
> 2. **Comment** on it, reply to that comment from the hover bar (thread opens inline), and paste or drop an image into the composer — it uploads and renders a thumbnail.
> 3. Breadcrumb back to **#ideas**: the post row shows the comment count and tags. Click the `bug` chip — the list filters and the URL carries `?tag=bug`; **Clear** restores it.
> 4. On the post, the checklist icon → **Create task**. The title comes prefilled from the post title. Open **Tasks** — the card carries a **from #ideas** chip; clicking it lands back on the post.
> 5. Hover a **comment** → Create task → the new card's chip jumps back to the exact comment and flashes it.
> 6. Delete the post (trash icon → confirm). Its comments are gone with it; on the Tasks board both cards survive but their chips are gone (provenance orphaned, tasks kept — SPEC §2.3).
>
> **Still open (async), updated 2026-08-22:** ~~the G1 two-browser checklist~~ **clear** · ~~the G2 seven-step checklist~~ **clear** · ~~this G3 checklist~~ **clear — run by Ethan 2026-08-22, no findings** · delete the `guest` auth user · confirm `VITE_MOCK_BACKEND` is unset in Cloudflare Pages · **TEAM BETA — inviting the team stays blocking on Ethan (DECISIONS #21).**

---

## P4 — Docs · Aug 22–25 *(orig. Aug 20–23)*

- [x] Collections tree
- [x] BlockNote pages with debounced autosave (1s)
- [x] Soft edit-lock — "someone is editing" banner with the editor's display name via `editing_heartbeat_at`, **no CRDT**
- [x] Image upload into pages
- [x] Insert-link-to-task/message inside a page
- [x] "Linked items" backlink panel on pages and tasks

**GATE G4** — Two users: the second sees the editing warning · images persist · a page links to a task and the task shows the page under Linked items.

> **Gate run 2026-08-22 — machine side PASS.** `npm run build` exit 0 with the entry chunk at **723.35 kB / 212.85 kB gzip — unchanged within noise from G3 despite BlockNote**, because `/docs/*` is the app's first lazy route: BlockNote rides a 1,032 kB / 315 kB gzip `DocsArea` chunk (plus its own sub-chunks and the Inter fonts) that chat-only sessions never fetch; the 500 kB warning stays un-silenced per DECISIONS #20. `npm run lint` exit 0, `npm run test` 334 tests / 15 files green, `npm run seed` **74/74 probes** green against live Supabase — including the eleven new P4 probes: four verbs on `collections`/`pages`, `updated_at` defaulting, the collection-delete FK pair (child collection **cascades**, page survives **un-filed**), and planted-row anon denials for both tables. A scripted live probe (both seed users, real anon sessions; output recorded here, script deleted per DECISIONS #19's precedent) proved the **edit-lock data path** — claim visible cross-user and naming the claimant, self never named, a 46s-old heartbeat names nobody, release guarded by ownership (releasing someone else's claim touched 0 rows) — the **links diff-sync round trip** — a document linking a task grew exactly one `references` edge, the task's backlink query resolved the page by title, deleting the link text removed the edge — and **image path persistence** — `body_rich` holds the storage path (never a signed URL) and the second user signed and fetched the object. Migration reviewed pre-push (FAIL on a SPEC §2.3 gap → SPEC amended in the same commit → re-review PASS). Batch reviewer over the whole phase diff (9 commits, 28 files, +3.4k/−59): **PASS** with five non-blocking notes — two fixed in the gate commit (a lock-poll staleness guard; an uncaught clipboard write), two parked in BACKLOG (mock FK fidelity; stale `references` edges), one was the throwaway probe itself, deleted as designed.
>
> **All three acceptance items have a visual half that needs a browser and two users, so none is PASS on Claude's authority** — they are Ethan's checklist below. `GATE G4 (machine): PASS`.
>
> **Ethan's G4 checklist** (~5–10 min on https://threadline-cc0.pages.dev after the deploy finishes; needs two windows, one incognito, signed in as two different users):
> 1. Sidebar → **Docs**. The **Handbook** collection holds **Welcome**. Click **New page** — you land in an empty editor; type a few words and watch the header flip **Saving… → Saved**; edit the title and the page list on the left follows it.
> 2. **Both windows on the same page.** Type in window A; within ~15s window B shows a banner naming A ("… is editing this page"). A navigates away (click another page); B's banner drops within ~15s. Type in A again, then close A's tab outright — B's banner drops within ~60s (a closed tab cannot release, so staleness clears it).
> 3. **Paste or drag an image** into the editor. It uploads and renders. **Hard-refresh** — still there. Open the same page in the second window — the image renders there too (fresh signed URL, private bucket).
> 4. In the editor header click the **link icon** → pick a task from the picker → a link lands in the text at the cursor. Wait for **Saved**, open **Tasks**, open that task — the page appears under **Linked items**; click it and you land back on the page. Back on the page, delete the link's text, wait for Saved, reopen the task — the Linked items entry is gone.
> 5. In a chat channel, hover a message → the new **Copy link** icon (flips to a check). Paste into a doc page — it becomes a link; click it and you land in the channel scrolled to that exact message, flashed.
> 6. Make a scratch page, drop an image in, then **trash icon → Confirm delete** — you land back at /docs and the page is gone from the list. (Only the creator sees the trash icon; check the second user does not, on a page they did not create.)
>
> **Still open (async), updated 2026-08-22:** ~~the G3 six-step checklist~~ **clear** · this G4 checklist · delete the `guest` auth user · confirm `VITE_MOCK_BACKEND` is unset in Cloudflare Pages · **TEAM BETA — inviting the team stays blocking on Ethan (DECISIONS #21).**

---

## P5 — Search & notifications · Aug 26–27 *(orig. Aug 24–25)*

- [x] ⌘K unified search calling `search_all` — grouped results, jump-to-entity
- [x] `search_tsv` + GIN on `posts`, `pages`, `tasks` *(`messages` already has it from P0)*
- [x] ~~In-app notification bell — mentions, assignments, replies — with mark-read~~ **shipped in P1** (DECISIONS #16). What remained here — `assignment` notifications — **shipped at P5**.
- [x] Vitest: search query builder

**GATE G5** — One search box finds a phrase from a week-old chat message, a task by title, and a doc by heading text · bell shows a mention within seconds.

> **Gate run 2026-08-22 — machine side PASS.** `npm run build` exit 0 (entry **728.27 kB / 214.33 kB gzip** — +1.5 kB gzip for the whole search UI, zero new dependencies; the docs chunk unchanged), `npm run lint` exit 0, `npm run test` 351 tests / 16 files green, `npm run seed` **82/82 probes** green — including the six new search probes (union across all four tables · a body-less page still matches on its title, proving the coalesce · message hits carry `(channel, #general)` · bracket-marker snippets · the scaffolding decision: searching "paragraph" matches no document that never says it · tombstones drop) and three function-refusal probes (`unread_counts`, `search_all`, `flatten_rich_text` all `42501` sessionless). A scripted live probe replicated the bell's exact subscription as user B while user A inserted the assignment row `useTasks` writes — received within seconds, after first timing out on a cold pipeline, which is DECISIONS #20's warm-up trap **reconfirmed a third time**. Both migrations were reviewed pre-push: the search migration **FAIL→fix→PASS** (lax-mode jsonpath collected every text value twice — measured live before and after; fixed with `strict`+`silent` — plus query-time re-weighting of the unweighted P0 messages vector), and the first post-push seed run then caught `search_all` still executable by `anon` (the #18 lesson half-applied: the explicit anon grant was revoked but the PUBLIC ACL entry remained) — closed by a second reviewed migration, verified by ACL inspection and the 42501 probes. Batch reviewer over the whole phase diff (3 commits, 14 files, +1.1k/−42): **PASS** with six non-blocking notes — four fixed in the gate commit (⌘K-toggle now resets through close(), timer cleanup on unmount, a failed assignment notice on plain create no longer traps the dialog into double-creating, the seed's tombstone probe keeps its findable body, title-only hits render no empty snippet line + mock parity), one recorded (the search migration file carries a UTF-8 BOM from a PowerShell rewrite — DECISIONS #25's trap; already applied cleanly by the CLI, left untouched per Non-negotiable 6, noted for the P6 redeploy rehearsal), one is the DECISIONS #28 entry landing in this commit.
>
> **The acceptance items' visual halves need a browser and two users** — Ethan's checklist below. `GATE G5 (machine): PASS`.
>
> **Ethan's G5 checklist** (~5 min on https://threadline-cc0.pages.dev after the deploy finishes; two windows, two users):
> 1. **⌘K** (or Ctrl+K) anywhere → type a phrase you remember from an old chat message → a **Messages** group appears titled `#channel`, matched words highlighted → click → you land in the channel scrolled to that exact message, flashed.
> 2. ⌘K → type a task's title → **Tasks** group → click → the task's dialog opens on the board.
> 3. ⌘K → type `team docs` → **Pages** group shows **Welcome** → click → the page opens. (Post titles work the same under **Posts**.)
> 4. In window A, open a task and set **Assignee** to window B's account → B's bell rings within seconds — "… assigned you a task" — and clicking it opens that task's dialog. (Hidden-tab variant: keep B's tab backgrounded and it arrives as a browser notification.)
> 5. Mention B in a channel from A → B's bell shows it within seconds (the gate line's second half, re-affirming G1's realtime path).
>
> **Still open (async), updated 2026-08-23:** ~~the G3 checklist~~ **clear** · the G4 checklist · this G5 checklist · ~~delete the `guest` auth user~~ **done 2026-08-22 via the admin API, in the same call as the mock removal (DECISIONS #29)** · ~~confirm `VITE_MOCK_BACKEND` is unset in Cloudflare Pages~~ **moot — no source reads that flag any more (DECISIONS #29); a stale value in Pages is inert** · **TEAM BETA — inviting the team stays blocking on Ethan (DECISIONS #21).**

---

## P6 — Harden & ship · Aug 28–31 *(orig. Aug 26–31)*

- [ ] Team bug-bash fixes — **priority over everything** *(three rounds shipped so far — DECISIONS #26, #29, #31. The item stays open for as long as the beta runs; each round is verified as its own batch, not at a gate.)*
- [x] Data-export button — authenticated JSON dump of all content tables. **Day-one insurance, do not skip** *(shipped early, 2026-08-22 — the rest of P6 is calendar- or beta-gated)*
- [x] Dependency freeze — Aug 28 *(declared early, 2026-08-22: the app is feature-complete, so nothing buys waiting. From here `package.json` changes only if a priority-one fix demands one, recorded in DECISIONS.)*
- [ ] Clean-environment redeploy rehearsal — Aug 30 *(repo half rehearsed 2026-08-22: fresh clone → `npm ci` → secret-less mock build → 357 tests, all green — the repository is self-contained. Remaining for the real run: migration replay against a fresh database — watch DECISIONS #28's BOM file — and the Cloudflare env.)*
- [ ] Timeboxed polish
- [ ] **SHIP — Aug 31**

> **Beta round 3 batch verify — 2026-08-23, PASS.** Seven commits (`77b80ed`…`777315b`): fractional ordering extracted to `src/lib/ordering.ts`, drag-to-reorder on the sidebar and the docs tree, the `position` migration, the task read view and its grip, whole-row click targets, live probes for the new columns, and the review fixes. `npm run build` exit 0 — entry **789.37 kB / 235.56 kB gzip**, `DocsArea` 1,014.31 kB / 308.31 kB gzip; +61 kB raw over G5 for beta rounds 2–3 together, the 500 kB warning still un-silenced per DECISIONS #20. `npm run lint` exit 0, `npm run test` **334 tests / 18 files** green — down from G5's 351 because `5ece345` deleted the mock's 42-test file, `ordering.test.ts` is the new one. `npm run seed` **91/91 probes** green against live Supabase, including five new ordering probes. The migration was reviewed before `db push` and is applied on the remote under exactly its repo filename. Batch reviewer over the whole diff: **FAIL** with two confirmed findings — the docs tree wrote an inverted position on a second drag, and the board's only drag grip could never become visible — both fixed in `777315b` along with two of the four non-blocking notes; **re-review PASS**. DECISIONS #31 carries the detail, including the one thing deliberately left alone.

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
