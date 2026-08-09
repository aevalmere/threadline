# Threadline

A team's discussion-to-action hub, where every thread keeps its through-line from chat to task to doc.

Internal platform for one small trusted team (5–30 people). Discord + Notion + Linear lite, merged: realtime chat, forum posts, doc pages, and a task kanban — with **create task from message** tying them together.

## Stack

Vite + React + TypeScript SPA · Supabase (Postgres, Auth, Realtime, Storage) · shadcn/ui + Tailwind · BlockNote · dnd-kit · Postgres full-text search · Cloudflare Pages.

## Getting started

Node lives at `C:\Program Files\nodejs` and is not on PATH — prefix commands that need it:

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
```

```bash
npm install
cp .env.example .env.local     # fill in your Supabase URL + anon key
npm run dev                    # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc -b && vite build` → `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |
| `npm run test` | Vitest |
| `npm run seed` | Seed data + the four-verb anon RLS check |
| `npx supabase db push` | Apply migrations to the linked project |

## Where things live

`SPEC.md` is the source of truth for schema and product behavior. `ROADMAP.md` owns sequencing and the phase gates. `DECISIONS.md` records why things are the way they are. `CLAUDE.md` holds the working rules.
