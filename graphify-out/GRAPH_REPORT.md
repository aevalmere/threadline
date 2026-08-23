# Graph Report - threadline  (2026-08-22)

## Corpus Check
- 194 files · ~137,596 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1148 nodes · 2214 edges · 116 communities (62 shown, 54 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `20c4afd2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- PostView.tsx
- PageView.tsx
- Tasks.tsx
- 2.3 Tables
- devDependencies
- AttachmentView.tsx
- posts.ts
- CommandPalette.tsx
- useMessages.ts
- compilerOptions
- compilerOptions
- seed.ts
- auth-context.ts
- cn
- components.json
- Supabase
- export.ts
- dependencies
- public.search_all
- scripts
- blast.ts
- DECISIONS.md
- public.posts
- public.search_all
- 20260809120000_profiles.sql
- index.ts
- 20260810121924_usernames.sql
- tsconfig.json
- package.json
- public.channels
- public.unread_counts
- public.tasks
- public.messages
- public.collections
- vite-env.d.ts
- public.notifications
- @blocknote/react
- @blocknote/shadcn
- cmdk
- @dnd-kit/core
- @dnd-kit/sortable
- lucide-react
- .mcp.json
- @radix-ui/react-dialog
- @radix-ui/react-slot
- react
- react-dom
- react-router-dom
- @supabase/supabase-js
- tailwind-merge
- 20260810030333_attachments.sql
- public.profiles
- Changelog
- Writing Guidelines for Postgres References
- WebForge Explain
- Changelog
- WebForge Perf
- Interaction states - exact specifications
- WebForge UI
- CLAUDE.md
- WebForge NoSlop
- Performance budgets and regression gates
- Explanation templates, filled in
- Banned patterns
- Section Definitions
- ROADMAP.md — Threadline
- Checklist
- gate.md
- Supabase Postgres Best Practices
- BACKLOG.md — v1.1 and beyond
- Threadline
- advanced-full-text-search.md
- advanced-jsonb-indexing.md
- conn-idle-timeout.md
- conn-limits.md
- conn-pooling.md
- conn-prepared-statements.md
- data-batch-inserts.md
- data-n-plus-one.md
- data-pagination.md
- data-upsert.md
- lock-advisory.md
- lock-deadlock-prevention.md
- lock-short-transactions.md
- lock-skip-locked.md
- monitor-explain-analyze.md
- monitor-pg-stat-statements.md
- monitor-vacuum-analyze.md
- query-composite-indexes.md
- query-covering-indexes.md
- query-index-types.md
- query-missing-indexes.md
- query-partial-indexes.md
- schema-constraints.md
- schema-data-types.md
- schema-foreign-key-indexes.md
- schema-lowercase-identifiers.md
- schema-partitioning.md
- schema-primary-keys.md
- security-privileges.md
- security-rls-basics.md
- security-rls-performance.md
- _template.md
- public.channels
- public.collections
- public.pages

## God Nodes (most connected - your core abstractions)
1. `cn()` - 62 edges
2. `useAuth()` - 44 edges
3. `useProfiles()` - 31 edges
4. `Button()` - 25 edges
5. `useMessages()` - 22 edges
6. `PostView()` - 21 edges
7. `useChannels()` - 20 edges
8. `compilerOptions` - 20 edges
9. `supabase` - 18 edges
10. `compilerOptions` - 17 edges

## Surprising Connections (you probably didn't know these)
- `Column()` --calls--> `cn()`  [EXTRACTED]
  src/routes/Tasks.tsx → src/lib/utils.ts
- `DraggableCard()` --calls--> `cn()`  [EXTRACTED]
  src/routes/Tasks.tsx → src/lib/utils.ts
- `AssigneeAvatar()` --calls--> `useProfiles()`  [EXTRACTED]
  src/routes/Tasks.tsx → src/lib/profiles-context.ts
- `onDragEnd()` --indirect_call--> `byPosition()`  [INFERRED]
  src/routes/DocsArea.tsx → src/lib/ordering.ts
- `Command()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/command.tsx → src/lib/utils.ts

## Import Cycles
- None detected.

## Communities (116 total, 54 thin omitted)

### Community 0 - "PostView.tsx"
Cohesion: 0.06
Nodes (56): App(), DocsArea, MemberList(), Sidebar(), ComposerHandle, EditBox(), MessageBody(), MessageGroupRow() (+48 more)

### Community 1 - "PageView.tsx"
Cohesion: 0.10
Nodes (45): ChannelsProvider(), appendPosition(), byPosition(), POSITION_STEP, positionBetween(), Positioned, positionForMove(), AUTOSAVE_DEBOUNCE_MS (+37 more)

### Community 2 - "Tasks.tsx"
Cohesion: 0.08
Nodes (49): LinkedItems(), SourceChip(), TaskDialog(), TaskForm(), TaskSource, TaskBody(), TaskView(), plainFromRich() (+41 more)

### Community 3 - "2.3 Tables"
Cohesion: 0.06
Nodes (30): 1.10 Search, 1.1 Workspace model, 1.2 Channels, 1.3 Messages — one table, three jobs, 1.4 Unread badges, 1.5 Reconnect and resync, 1.6 Tasks, 1.7 Docs (+22 more)

### Community 4 - "devDependencies"
Cohesion: 0.05
Nodes (39): dotenv, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, devDependencies, dotenv (+31 more)

### Community 5 - "AttachmentView.tsx"
Cohesion: 0.09
Nodes (43): PageEditor(), AttachmentView(), Preview(), Composer, attachmentsByOwner(), CheckableFile, extensionOf(), FileCheck (+35 more)

### Community 6 - "posts.ts"
Cohesion: 0.16
Nodes (24): PostForm(), submit(), commentCounts(), filterByTag(), normalizeTagName(), parseTagInput(), Post, POST_COLUMNS (+16 more)

### Community 7 - "CommandPalette.tsx"
Cohesion: 0.13
Nodes (22): LinkPicker(), Pickable, CommandPalette(), onQueryChange(), GROUP_ICONS, Command(), CommandDialog(), CommandEmpty() (+14 more)

### Community 8 - "useMessages.ts"
Cohesion: 0.18
Nodes (23): channelParent(), hasMorePages(), highestMessageId(), IdentifiedMessage, mergeMessages(), MessageParent, oldestMessageId(), PAGE_SIZE (+15 more)

### Community 9 - "compilerOptions"
Cohesion: 0.08
Nodes (25): DOM, DOM.Iterable, ES2022, src, compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules (+17 more)

### Community 10 - "compilerOptions"
Cohesion: 0.09
Nodes (22): ES2023, node, scripts, vite.config.ts, compilerOptions, allowImportingTsExtensions, isolatedModules, lib (+14 more)

### Community 11 - "seed.ts"
Cohesion: 0.26
Nodes (21): accountsCheck(), admin, attachmentsCheck(), deniedWithoutSession(), die(), ensureChannel(), ensureCollection(), ensurePage() (+13 more)

### Community 12 - "auth-context.ts"
Cohesion: 0.07
Nodes (33): AppShell(), CurrentChannelTitle(), NotificationBell(), relativeTime(), AppShellSearchHint(), AuthProvider(), AuthContext, AuthContextValue (+25 more)

### Community 13 - "cn"
Cohesion: 0.06
Nodes (45): PostDialog(), PostFields, TagChip(), AuthorAvatar(), navClass(), SortableChannelList(), SortableChannelRow(), Avatar() (+37 more)

### Community 14 - "components.json"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 15 - "Supabase"
Cohesion: 0.12
Nodes (14): Fix suggestion, Source, What happened, Skill Feedback, Steps, Core Principles, Making and Committing Schema Changes, Option A: Declarative schemas (+6 more)

### Community 16 - "export.ts"
Cohesion: 0.27
Nodes (10): EXPORT_MAX_PAGES, EXPORT_PAGE_SIZE, EXPORT_TABLES, exportFilename(), exportWorkspace(), fetchAllRows(), FetchPage, WorkspaceExport (+2 more)

### Community 18 - "dependencies"
Cohesion: 0.18
Nodes (11): @blocknote/core, class-variance-authority, clsx, @dnd-kit/utilities, dependencies, @blocknote/core, class-variance-authority, clsx (+3 more)

### Community 19 - "public.search_all"
Cohesion: 0.22
Nodes (8): public.attachments, public.search_all(), public.channels, public.messages, public.pages, public.posts, public.profiles, public.tasks

### Community 20 - "scripts"
Cohesion: 0.25
Nodes (8): scripts, blast, build, dev, lint, preview, seed, test

### Community 21 - "blast.ts"
Cohesion: 0.25
Nodes (5): admin, asUser, count, delay, stamp

### Community 23 - "DECISIONS.md"
Cohesion: 0.05
Nodes (37): #10 — 2026-08-10 — TEMPORARY: the workspace is open to anonymous users, #11 — 2026-08-10 — Deleting a message destroys its content; supersedes #9's orphan bullet, #12 — 2026-08-10 — An in-memory mock backend for offline development, #13 — 2026-08-10 — Guest access reverted; supersedes #10, #14 — 2026-08-10 — Accounts: invite-code registration, username + password sign-in, #15 — 2026-08-10 — Mentions are plain `@username`, and the bell rows are written client-side, #16 — 2026-08-10 — The bell is pulled forward to P1, and it fires OS notifications, #17 — 2026-08-10 — Jump-to-message: two failures, and the invariant that ends them (+29 more)

### Community 24 - "public.posts"
Cohesion: 0.32
Nodes (7): public.post_tags, public.posts, public.tags, public.channels, public.messages, public.profiles, public.tasks

### Community 25 - "public.search_all"
Cohesion: 0.25
Nodes (6): public.search_all(), public.channels, public.messages, public.pages, public.posts, public.tasks

### Community 26 - "20260809120000_profiles.sql"
Cohesion: 0.33
Nodes (4): public.handle_new_user, on_auth_user_created, public.profiles, auth.users

### Community 28 - "20260810121924_usernames.sql"
Cohesion: 0.40
Nodes (4): public.email_for_username(), public.handle_new_user(), auth.users, public.profiles

### Community 29 - "tsconfig.json"
Cohesion: 0.33
Nodes (5): compilerOptions, baseUrl, paths, files, references

### Community 30 - "package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 31 - "public.channels"
Cohesion: 0.60
Nodes (4): public, public.channel_members, public.channels, public.profiles

### Community 32 - "public.unread_counts"
Cohesion: 0.40
Nodes (4): public.channel_members, public.unread_counts(), public.channels, public.messages

### Community 34 - "public.tasks"
Cohesion: 0.40
Nodes (4): public.links, public.tasks, public.messages, public.profiles

### Community 35 - "public.messages"
Cohesion: 0.67
Nodes (3): public.messages, public.channels, public.profiles

### Community 36 - "public.collections"
Cohesion: 0.83
Nodes (3): public.collections, public.pages, public.profiles

### Community 64 - "Changelog"
Cohesion: 0.12
Nodes (16): [1.2.0](https://github.com/supabase/agent-skills/compare/v1.1.1...v1.2.0) (2026-06-02), [1.3.0](https://github.com/supabase/agent-skills/compare/v1.2.0...v1.3.0) (2026-06-05), [1.4.0](https://github.com/supabase/agent-skills/compare/v1.3.0...v1.4.0) (2026-07-10), [1.5.0](https://github.com/supabase/agent-skills/compare/supabase-postgres-best-practices-v1.4.0...supabase-postgres-best-practices-v1.5.0) (2026-07-30), [1.6.0](https://github.com/supabase/agent-skills/compare/supabase-postgres-best-practices-v1.5.0...supabase-postgres-best-practices-v1.6.0) (2026-07-30), Bug Fixes, Bug Fixes, Bug Fixes (+8 more)

### Community 65 - "Writing Guidelines for Postgres References"
Cohesion: 0.12
Nodes (15): 1. Concrete Transformation Patterns, 2. Error-First Structure, 3. Quantified Impact, 4. Self-Contained Examples, 5. Semantic Naming, Code Example Standards, Comments, Impact Level Guidelines (+7 more)

### Community 66 - "WebForge Explain"
Cohesion: 0.13
Nodes (14): Activation receipt, Analogies, Architecture decision record, Calibrated confidence, Change brief, Interop, Pick the output shape, Quality checklist (+6 more)

### Community 67 - "Changelog"
Cohesion: 0.14
Nodes (13): [0.1.3](https://github.com/supabase/agent-skills/compare/v0.1.2...v0.1.3) (2026-06-02), [0.1.4](https://github.com/supabase/agent-skills/compare/v0.1.3...v0.1.4) (2026-06-05), [0.1.5](https://github.com/supabase/agent-skills/compare/v0.1.4...v0.1.5) (2026-07-10), [0.1.6](https://github.com/supabase/agent-skills/compare/v0.1.5...supabase-v0.1.6) (2026-07-30), Bug Fixes, Bug Fixes, Bug Fixes, Bug Fixes (+5 more)

### Community 68 - "WebForge Perf"
Cohesion: 0.14
Nodes (13): Activation receipt, Attributing a regression, Budgets, Commands, Field versus lab, Interop, Name the phase before writing code, Quality checklist (+5 more)

### Community 69 - "Interaction states - exact specifications"
Cohesion: 0.14
Nodes (13): 10. Density and target size, 11. Worked example: a button, 1. The nine states, 2. Hover, 3. Focus, 4. Active and pressed, 5. Disabled, 6. Loading (+5 more)

### Community 70 - "WebForge UI"
Cohesion: 0.14
Nodes (13): Activation receipt, Component library decision, Definition of done for any component, Forms, Interop, Layout and structure rules, Quality checklist, Reference files (+5 more)

### Community 71 - "CLAUDE.md"
Cohesion: 0.15
Nodes (11): Commands, Environment quirks, File map, Installed skills and MCP — and where they contradict this file, Locked stack — never swap, never "improve", Non-goals — hard NO for v1, Non-negotiables, Pre-agreed fallbacks (+3 more)

### Community 72 - "WebForge NoSlop"
Cohesion: 0.17
Nodes (11): Activation receipt, Code sweep, Commit and PR text, Interop, Prose sweep, Quality checklist, Reference files, The constructions that survive vocabulary swaps (+3 more)

### Community 73 - "Performance budgets and regression gates"
Cohesion: 0.17
Nodes (11): 1. What makes a budget a budget, 2. Numbers to budget against, 3. Lighthouse CI, 4. size-limit, 5. k6 for API latency, 6. Reading the Lighthouse score, 7. Per-route First Load JS, 8. Choosing the throttling profile (+3 more)

### Community 74 - "Explanation templates, filled in"
Cohesion: 0.18
Nodes (10): 1. Architecture decision record, 2. Design doc, 3. Change brief, 4. Trade-off table, 5. Review comments, 6. Delivery structures, 7. Diagrams in text, 8. A worked end-to-end example (+2 more)

### Community 75 - "Banned patterns"
Cohesion: 0.18
Nodes (10): 1. Words, 2. Openers, filler, closers, 3. Sentence constructions, 4. Structural habits, 5. Tone failures, 6. Punctuation, 7. Code-level patterns, 8. Why this list is not aesthetic preference (+2 more)

### Community 76 - "Section Definitions"
Cohesion: 0.20
Nodes (9): 1. Query Performance (query), 2. Connection Management (conn), 3. Security & RLS (security), 4. Schema Design (schema), 5. Concurrency & Locking (lock), 6. Data Access Patterns (data), 7. Monitoring & Diagnostics (monitor), 8. Advanced Features (advanced) (+1 more)

### Community 77 - "ROADMAP.md — Threadline"
Cohesion: 0.20
Nodes (9): Never-break test paths, P0 — Foundation · Aug 9 *(orig. Aug 5–6)*, P1 — Chat · Aug 10–17 *(orig. Aug 7–13)*, P2 — Tasks · Aug 18–20 *(orig. Aug 14–16)*, P3 — Forums · Aug 19–21 *(orig. Aug 17–19)*, P4 — Docs · Aug 22–25 *(orig. Aug 20–23)*, P5 — Search & notifications · Aug 26–27 *(orig. Aug 24–25)*, P6 — Harden & ship · Aug 28–31 *(orig. Aug 26–31)* (+1 more)

### Community 78 - "Checklist"
Cohesion: 0.22
Nodes (8): (a) Violations of the ten Non-negotiables, (b) Regressions in the message ↔ task ↔ doc linked paths, (c) Migration safety, Checklist, (d) Missing verification evidence, (e) Secrets, Ground truth, Output format

### Community 79 - "gate.md"
Cohesion: 0.29
Nodes (6): 1. Machine checks, 2. Acceptance walk, 3. Reviewer subagent — one run, whole batch, 4. Verdict table, 5a. On machine PASS, 5b. On FAIL

### Community 80 - "Supabase Postgres Best Practices"
Cohesion: 0.33
Nodes (5): How to Use, References, Rule Categories by Priority, Supabase Postgres Best Practices, When to Apply

### Community 81 - "BACKLOG.md — v1.1 and beyond"
Cohesion: 0.33
Nodes (5): BACKLOG.md — v1.1 and beyond, Explicit v1 non-goals, Ideas parked during the build, Ideas parked during the build, Promoted to v1 stretch

### Community 83 - "Threadline"
Cohesion: 0.40
Nodes (4): Getting started, Stack, Threadline, Where things live

## Knowledge Gaps
- **432 isolated node(s):** `View`, `DialogState`, `JumpCandidate`, `JumpDecision`, `ThreadableMessage` (+427 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **54 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useAuth()` connect `PostView.tsx` to `PageView.tsx`, `Tasks.tsx`, `AttachmentView.tsx`, `posts.ts`, `useMessages.ts`, `auth-context.ts`, `cn`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `cn()` connect `cn` to `PostView.tsx`, `Tasks.tsx`, `AttachmentView.tsx`, `CommandPalette.tsx`, `auth-context.ts`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `useProfiles()` connect `PostView.tsx` to `PageView.tsx`, `Tasks.tsx`, `AttachmentView.tsx`, `posts.ts`, `useMessages.ts`, `auth-context.ts`, `cn`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `View`, `DialogState`, `JumpCandidate` to the rest of the system?**
  _432 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `PostView.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.05823293172690763 - nodes in this community are weakly interconnected._
- **Should `PageView.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.09506531204644413 - nodes in this community are weakly interconnected._
- **Should `Tasks.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.08035714285714286 - nodes in this community are weakly interconnected._