# BACKLOG.md — v1.1 and beyond

The parking lot. Nothing here gets built before **August 31, 2026**.

When the user asks for something on this list mid-build: remind them of the ship date, append it here (or note the extra ask under an existing entry), and carry on with the current ROADMAP item.

---

## Explicit v1 non-goals

Hard NO for v1. Listed so a future session doesn't mistake their absence for an oversight.

| Item | Note |
|---|---|
| Billing | No payments, plans, or seats. Internal tool. |
| Roles & permissions | One trusted workspace; auth is the only wall. Adding roles means rewriting every RLS policy. |
| Native mobile apps | Responsive web only. |
| Voice / video | |
| Collaborative co-editing (Yjs / CRDT) | P4 ships a soft edit-lock banner instead. |
| Email digests | No email of any kind. |
| ~~Push notifications~~ | **Partially reversed — DECISIONS #16.** The bell fires a browser `Notification` when the tab is hidden, at Ethan's request. That needs the tab *open*, so it is not push: no service worker, no push service, no server→device path. Real push is still out. |
| Read receipts | |
| Edit history | Messages keep `edited_at`, not versions. |
| Custom emoji | |
| Per-channel notification prefs | |
| Kanban automations | |
| Backlink graph visualization | The "Linked items" list panel covers the need. |
| External search service | Postgres FTS only — no Meilisearch, Typesense, Algolia, Elasticsearch. |

## Promoted to v1 stretch

These two are the **only** backlog items allowed to jump the queue, and only if the P6 bug-bash is quiet by Aug 30:

- **DMs as private 2-person channels** — near-zero new infra on the existing schema.
- **Emoji reactions** — one join table.

## Ideas parked during the build

*(append here as they come up — one line each, with the date and who asked)*

## Ideas parked during the build

- **2026-08-09 (Ethan)** — Persist the optimistic send queue across a page reload. Today a failed send keeps its bubble and Retry across a channel switch, but not a browser reload: `pending` is React state, so refreshing loses the unsent text. Closing it means writing the queue to localStorage keyed by channel and rehydrating on mount. Narrow (send must fail *and* the user must reload), so it is parked rather than built.
- **2026-08-09 (Ethan)** — Deep-linkable thread pages: a `/channels/:channelId/t/:rootId` route so a thread has a shareable URL and a focused mobile view, alongside the inline expansion. Ethan asked for "separate page threads" while questioning whether Discord-style threads would suit the workflow better. Conclusion: keep chat threads lightweight, because P3 forum posts already own the heavy titled-discussion niche and shipping both would give the team two overlapping tools. **Consider pulling this forward into P2** — "create task from message" needs jump-to-exact-message navigation, which is most of the same machinery.
- **2026-08-09 (Ethan)** — Richer thread affordance: show last-reply time and participant avatars next to "N replies", instead of the bare count.
- ~~**2026-08-09 (Ethan)** — Database-level guard for the one-level-deep thread rule.~~ **PULLED FORWARD into P1 the same day** at Ethan's request — it is a ROADMAP P1 item now, not a backlog entry. See DECISIONS #8.
- **2026-08-10 (Ethan)** — Image compression before upload, and a lossless-vs-WebP decision per file. Re-encode large images to WebP (or AVIF) client-side and keep the original only when it is actually smaller, to stretch the free tier's 1 GB storage and 5 GB egress. Wants a real comparison of lossless vs lossy for screenshots, which are the common case here. Deferred: `browser-image-compression` or a canvas re-encode is a small library decision, but it is a locked-stack addition and DECISIONS #9 already notes the cap and the orphan sweep as the storage levers to pull first.
- **2026-08-10 (found in review)** — Realtime for attachment deletion. `deleteAttachment` has no subscription counterpart: only INSERTs on `attachments` are subscribed, so deleting a single file leaves other clients rendering it until reload, against a signed URL that now 404s. Deleting a whole message is unaffected (the message UPDATE propagates and the UI hides attachments on a tombstone). Needs the same thought as DECISIONS #4's column-list question, because a DELETE payload under the default replica identity carries only the primary key. See DECISIONS #11.
- **2026-08-18 (found in review)** — Code-split the client bundle. A real build is 631 kB / 186 kB gzip, over Vite's 500 kB warning. Fine for 5–30 internal users, so not worth doing before ship — but P4 adds BlockNote, which is where it starts to matter. The warning is deliberately left un-silenced so that growth stays visible; see DECISIONS #20. When it is worth doing, the lever is `manualChunks` or lazy route imports. *(P4 made the first split — the docs chunk; the mock this entry once weighed was removed entirely at Ethan's call, DECISIONS #29.)*
- **2026-08-18 (found in review)** — Refresh `profiles` when someone registers mid-session. `src/lib/profiles.tsx` fetches once per mount, so a teammate who registers after your tab loaded cannot be resolved by `parseMentions` — mentioning them writes no `notifications` row and they are never told. Widens as the team joins during TEAM BETA.
- **2026-08-18 (found in review)** — Realtime for channel creation. `src/lib/channels.tsx:26` claims "P1 later swaps the manual refresh() calls for a realtime subscription"; P1 shipped without it, so a channel someone else creates does not appear until reload. Fix the comment or build the subscription.
- **2026-08-22 (Ethan)** — **Database-level ownership enforcement** ("only OP can edit"). The UI now hides edit/delete affordances from non-authors (DECISIONS #26), but the database deliberately still allows any authenticated user to write anything — Non-negotiable 2's blanket policy. Enforcing ownership for real means reversing that rule deliberately: per-row RLS policies on messages/posts/tasks with carve-outs (the mentions flow inserts notifications into *other users'* rows — DECISIONS #15 — and task status needs to stay writable by non-creators), plus seed-probe rewrites. A security-pass project for after ship, not a patch; belongs with the invite-code rotation and password hygiene Ethan already plans.
- **2026-08-22 (P4 build)** — **`pagehide` flush for docs autosave and edit-lock release.** In-app navigation flushes the 1s autosave latch and releases the edit-lock on unmount, but closing the tab does neither: up to 1s of typing is lost and the claim lingers until the 45s staleness clears it. A `pagehide` handler doing a best-effort flush + release closes both; parked because the loss window is one second and staleness already covers the banner.
- ~~**2026-08-22 (G4 batch review)** — **The mock emulates no FK behavior on delete.**~~ **Moot 2026-08-22** — the mock backend was removed entirely at Ethan's call (DECISIONS #29).
- **2026-08-22 (G4 batch review)** — **Stale `references` edges re-grow, and `links` has no unique constraint.** Deleting a task sweeps its links rows, but a page document still holding `/tasks?t=<gone>` re-inserts the edge on its next autosave; nothing renders it, it just lingers. Separately, two tabs saving the same page concurrently can both insert the same edge (backlinks dedupe by page id, so invisible). A unique index on `(source_type, source_id, target_type, target_id, kind)` plus an existence check in the sync would tidy both; belongs with the hardening pass, not a patch.
- **2026-08-22 (found in the P3 migration review, re-flagged by the batch reviewer)** — **Channel deletion orphans its messages' attachments in storage.** `deleteChannel` (`src/lib/channels.tsx:96`) deletes the row; the FK cascades the messages, but attachments have no FK, so their rows and storage objects survive and count against the 1 GB forever. P3 widens the blast radius: deleting a *forum* channel now cascades posts → comments → their attachment rows the same way. P3's per-post deletion sweeps exactly this (`deletePostRecord` in `src/lib/usePosts.ts`, per DECISIONS #11's bytes-freed promise) — the channel path predates that discipline and still leaks. Same fix shape; a P6 sweep or a `deleteChannelRecord` mirroring the post one.
