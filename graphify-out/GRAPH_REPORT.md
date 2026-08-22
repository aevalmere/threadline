# Graph Report - threadline  (2026-08-22)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 759 nodes · 1825 edges · 63 communities (44 shown, 19 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ca9d3ecf`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 54
- Community 59

## God Nodes (most connected - your core abstractions)
1. `cn()` - 59 edges
2. `useAuth()` - 44 edges
3. `useProfiles()` - 29 edges
4. `Button()` - 24 edges
5. `useMessages()` - 22 edges
6. `PostView()` - 21 edges
7. `compilerOptions` - 20 edges
8. `useChannels()` - 19 edges
9. `supabase` - 18 edges
10. `compilerOptions` - 17 edges

## Surprising Connections (you probably didn't know these)
- `Command()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/command.tsx → src/lib/utils.ts
- `ChannelView()` --calls--> `SplitThreads`  [EXTRACTED]
  src/routes/ChannelView.tsx → src/lib/threads.ts
- `PostView()` --calls--> `SplitThreads`  [EXTRACTED]
  src/routes/PostView.tsx → src/lib/threads.ts
- `navClass()` --calls--> `cn()`  [EXTRACTED]
  src/components/layout/Sidebar.tsx → src/lib/utils.ts
- `Thread()` --calls--> `useProfiles()`  [EXTRACTED]
  src/components/messages/Thread.tsx → src/lib/profiles-context.ts

## Import Cycles
- None detected.

## Communities (63 total, 19 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (60): PostDialog(), PostFields, AuthorAvatar(), navClass(), ComposerHandle, EditBox(), MessageGroupRow(), shortTime() (+52 more)

### Community 1 - "Community 1"
Cohesion: 0.09
Nodes (41): AUTOSAVE_DEBOUNCE_MS, collectHrefs(), Collection, COLLECTION_COLUMNS, EDIT_LOCK_POLL_MS, editingBanner(), flattenTree(), HEARTBEAT_INTERVAL_MS (+33 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (44): SourceChip(), TaskSource, plainFromRich(), richFromPlain(), RichParagraph, appendPosition(), assignmentNoticeRow(), fieldsFromTask() (+36 more)

### Community 3 - "Community 3"
Cohesion: 0.11
Nodes (32): PageEditor(), AttachmentView(), Preview(), attachmentsByOwner(), CheckableFile, extensionOf(), FileCheck, formatBytes() (+24 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (39): dotenv, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, devDependencies, dotenv (+31 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (25): Composer, MessageBody(), applyMention(), canStartMention(), matchMentions(), MentionCandidate, mentionQueryAt(), MentionSegment (+17 more)

### Community 6 - "Community 6"
Cohesion: 0.14
Nodes (26): PostForm(), submit(), TagChip(), commentCounts(), filterByTag(), normalizeTagName(), parseTagInput(), Post (+18 more)

### Community 7 - "Community 7"
Cohesion: 0.13
Nodes (22): LinkPicker(), Pickable, CommandPalette(), onQueryChange(), GROUP_ICONS, Command(), CommandDialog(), CommandEmpty() (+14 more)

### Community 8 - "Community 8"
Cohesion: 0.18
Nodes (23): channelParent(), hasMorePages(), highestMessageId(), IdentifiedMessage, mergeMessages(), MessageParent, oldestMessageId(), PAGE_SIZE (+15 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (25): DOM, DOM.Iterable, ES2022, src, compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules (+17 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (22): ES2023, node, scripts, vite.config.ts, compilerOptions, allowImportingTsExtensions, isolatedModules, lib (+14 more)

### Community 11 - "Community 11"
Cohesion: 0.26
Nodes (21): accountsCheck(), admin, attachmentsCheck(), deniedWithoutSession(), die(), ensureChannel(), ensureCollection(), ensurePage() (+13 more)

### Community 12 - "Community 12"
Cohesion: 0.15
Nodes (13): App(), DocsArea, MessageRow(), useAuth(), hasUnsafeCharacter(), safeNext(), AuthCallback(), Login() (+5 more)

### Community 13 - "Community 13"
Cohesion: 0.18
Nodes (13): AppShell(), CurrentChannelTitle(), MemberList(), AppShellSearchHint(), Sidebar(), useChannels(), useProfiles(), useUnread() (+5 more)

### Community 14 - "Community 14"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 15 - "Community 15"
Cohesion: 0.24
Nodes (12): AuthProvider(), AuthContext, AuthContextValue, RegisterInput, readFunctionError(), ProfilesContext, ProfilesContextValue, ProfilesProvider() (+4 more)

### Community 16 - "Community 16"
Cohesion: 0.35
Nodes (8): UnreadContext, UnreadContextValue, nextLastReadMessageId(), CountRow, UnreadProvider(), reconcileUnread(), unreadBadge(), UnreadMessage

### Community 17 - "Community 17"
Cohesion: 0.23
Nodes (5): NotificationBell(), relativeTime(), Notification, NotificationTarget, useNotifications()

### Community 18 - "Community 18"
Cohesion: 0.18
Nodes (11): @blocknote/core, class-variance-authority, clsx, @dnd-kit/utilities, dependencies, @blocknote/core, class-variance-authority, clsx (+3 more)

### Community 19 - "Community 19"
Cohesion: 0.22
Nodes (8): public.attachments, public.search_all(), public.channels, public.messages, public.pages, public.posts, public.profiles, public.tasks

### Community 20 - "Community 20"
Cohesion: 0.25
Nodes (8): scripts, blast, build, dev, lint, preview, seed, test

### Community 21 - "Community 21"
Cohesion: 0.25
Nodes (5): admin, asUser, count, delay, stamp

### Community 22 - "Community 22"
Cohesion: 0.50
Nodes (6): ChannelsProvider(), ChannelsContext, ChannelsContextValue, CreateChannelInput, friendly(), Channel

### Community 23 - "Community 23"
Cohesion: 0.32
Nodes (6): JumpCandidate, JumpDecision, resolveJump(), base(), REPLY, ROOT

### Community 24 - "Community 24"
Cohesion: 0.32
Nodes (7): public.post_tags, public.posts, public.tags, public.channels, public.messages, public.profiles, public.tasks

### Community 25 - "Community 25"
Cohesion: 0.25
Nodes (6): public.search_all(), public.channels, public.messages, public.pages, public.posts, public.tasks

### Community 26 - "Community 26"
Cohesion: 0.33
Nodes (4): public.handle_new_user, on_auth_user_created, public.profiles, auth.users

### Community 28 - "Community 28"
Cohesion: 0.40
Nodes (4): public.email_for_username(), public.handle_new_user(), auth.users, public.profiles

### Community 29 - "Community 29"
Cohesion: 0.33
Nodes (5): compilerOptions, baseUrl, paths, files, references

### Community 30 - "Community 30"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 31 - "Community 31"
Cohesion: 0.60
Nodes (4): public, public.channel_members, public.channels, public.profiles

### Community 32 - "Community 32"
Cohesion: 0.40
Nodes (4): public.channel_members, public.unread_counts(), public.channels, public.messages

### Community 33 - "Community 33"
Cohesion: 0.60
Nodes (3): LinkedItems(), Backlink, useBacklinks()

### Community 34 - "Community 34"
Cohesion: 0.40
Nodes (4): public.links, public.tasks, public.messages, public.profiles

### Community 35 - "Community 35"
Cohesion: 0.67
Nodes (3): public.messages, public.channels, public.profiles

### Community 36 - "Community 36"
Cohesion: 0.83
Nodes (3): public.collections, public.pages, public.profiles

## Knowledge Gaps
- **161 isolated node(s):** `PostFields`, `ChannelNameResult`, `GroupableMessage`, `MessageGroup`, `ThreadableMessage` (+156 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useAuth()` connect `Community 12` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 5`, `Community 6`, `Community 8`, `Community 13`, `Community 15`, `Community 16`, `Community 17`, `Community 22`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Why does `cn()` connect `Community 0` to `Community 2`, `Community 3`, `Community 5`, `Community 6`, `Community 7`, `Community 13`, `Community 17`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `supabase` connect `Community 15` to `Community 33`, `Community 1`, `Community 3`, `Community 2`, `Community 6`, `Community 7`, `Community 8`, `Community 16`, `Community 17`, `Community 22`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **What connects `PostFields`, `ChannelNameResult`, `GroupableMessage` to the rest of the system?**
  _161 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05881188118811881 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.09071117561683599 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.10558069381598793 - nodes in this community are weakly interconnected._