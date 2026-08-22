import { useMemo, useState, type FormEvent } from 'react'
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import {
  ChevronDownIcon,
  ChevronRightIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { flattenTree, type Collection, type PageMeta, type TreeRow } from '@/lib/pages'
import { useCollections, usePages } from '@/lib/useDocs'
import PageView from '@/routes/PageView'

/**
 * The docs surface — SPEC §1.7. This file is the root of the lazily imported
 * docs chunk: everything docs-only (BlockNote above all, ~300 kB gzip) must be
 * reachable only from here, so chat-only sessions never download the editor.
 *
 * Left pane: collections tree with each collection's pages under it. Right:
 * the index prompt or the open page. On mobile the panes swap on navigation
 * instead of sharing the width.
 */
export default function DocsArea() {
  const collectionsState = useCollections()
  const pagesState = usePages()
  const location = useLocation()
  const navigate = useNavigate()
  const atIndex = location.pathname === '/docs'

  return (
    <div className="flex h-full min-h-0">
      <aside
        className={`${atIndex ? 'block w-full md:w-64' : 'hidden md:block md:w-64'} shrink-0 overflow-y-auto border-r`}
      >
        <CollectionsPane
          collections={collectionsState}
          pages={pagesState}
          onOpenPage={(id) => navigate(`/docs/${id}`)}
        />
      </aside>
      <main className={`${atIndex ? 'hidden md:block' : 'block'} min-w-0 flex-1 overflow-y-auto`}>
        <Routes>
          <Route
            index
            element={
              <div className="flex h-full items-center justify-center p-6">
                <p className="text-muted-foreground text-sm">
                  Select a page, or create one from the left.
                </p>
              </div>
            }
          />
          <Route
            path=":pageId"
            element={
              <PageView
                collections={collectionsState.collections ?? []}
                onMove={pagesState.movePage}
                onChanged={() => void pagesState.refresh()}
                onDeleted={() => {
                  void pagesState.refresh()
                  navigate('/docs')
                }}
              />
            }
          />
        </Routes>
      </main>
    </div>
  )
}

function CollectionsPane({
  collections,
  pages,
  onOpenPage,
}: {
  collections: ReturnType<typeof useCollections>
  pages: ReturnType<typeof usePages>
  onOpenPage: (id: string) => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<Collection | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const tree = useMemo(
    () => flattenTree(collections.collections ?? []),
    [collections.collections],
  )
  const pagesByCollection = useMemo(() => {
    const grouped = new Map<string | null, PageMeta[]>()
    for (const p of pages.pages ?? []) {
      const list = grouped.get(p.collection_id)
      if (list) list.push(p)
      else grouped.set(p.collection_id, [p])
    }
    return grouped
  }, [pages.pages])

  const loading = collections.collections === null || pages.pages === null
  const loadError = collections.error ?? pages.error

  async function run(action: () => Promise<unknown>) {
    setActionError(null)
    try {
      await action()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="px-1 text-sm font-semibold tracking-tight">Docs</h1>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCreating(true)}
            title="New collection"
          >
            <FolderIcon /> <PlusIcon className="-ml-1.5" />
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void run(async () => {
                const page = await pages.createPage(null)
                onOpenPage(page.id)
              })
            }
          >
            <FilePlusIcon /> New page
          </Button>
        </div>
      </div>

      {loadError && (
        <p role="alert" className="text-destructive px-1 text-xs">
          Could not load docs: {loadError}
        </p>
      )}
      {actionError && (
        <p role="alert" className="text-destructive px-1 text-xs">
          {actionError}
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : tree.length === 0 && (pages.pages?.length ?? 0) === 0 ? (
        <p className="text-muted-foreground px-1 text-xs">
          No pages yet. Create one, or make a collection first.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {tree.map((row) => (
            <CollectionNode
              key={row.collection.id}
              row={row}
              pages={pagesByCollection.get(row.collection.id) ?? []}
              collapsed={collapsed.has(row.collection.id)}
              onToggle={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev)
                  if (next.has(row.collection.id)) next.delete(row.collection.id)
                  else next.add(row.collection.id)
                  return next
                })
              }
              hiddenByAncestor={ancestorCollapsed(row, tree, collapsed)}
              onNewPage={() =>
                void run(async () => {
                  const page = await pages.createPage(row.collection.id)
                  onOpenPage(page.id)
                })
              }
              onRename={() => setRenaming(row.collection)}
              onDelete={() => void run(() => collections.deleteCollection(row.collection.id))}
            />
          ))}
          <UnfiledPages pages={pagesByCollection.get(null) ?? []} />
        </ul>
      )}

      <Dialog open={creating} onOpenChange={(open) => !open && setCreating(false)}>
        <DialogContent>
          {creating && (
            <CollectionForm
              title="New collection"
              submitLabel="Create"
              parents={tree}
              onSubmit={async (name, parentId) => {
                await collections.createCollection(name, parentId)
              }}
              onDone={() => setCreating(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          {renaming && (
            <CollectionForm
              title="Rename collection"
              submitLabel="Rename"
              initialName={renaming.name}
              onSubmit={async (name) => {
                await collections.renameCollection(renaming.id, name)
              }}
              onDone={() => setRenaming(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Whether any ancestor of this row is collapsed — the row hides with it. */
function ancestorCollapsed(
  row: TreeRow,
  tree: readonly TreeRow[],
  collapsed: Set<string>,
): boolean {
  let parentId = row.collection.parent_id
  const byId = new Map(tree.map((r) => [r.collection.id, r.collection]))
  while (parentId !== null) {
    if (collapsed.has(parentId)) return true
    parentId = byId.get(parentId)?.parent_id ?? null
  }
  return false
}

function CollectionNode({
  row,
  pages,
  collapsed,
  hiddenByAncestor,
  onToggle,
  onNewPage,
  onRename,
  onDelete,
}: {
  row: TreeRow
  pages: PageMeta[]
  collapsed: boolean
  hiddenByAncestor: boolean
  onToggle: () => void
  onNewPage: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  if (hiddenByAncestor) return null
  const Chevron = collapsed ? ChevronRightIcon : ChevronDownIcon

  return (
    <>
      <li
        // Opacity reveal, not display — the action buttons stay tabbable
        // (DECISIONS #24's keyboard rule).
        className="group flex items-center gap-1 rounded px-1 py-1"
        style={{ paddingLeft: `${row.depth * 12 + 4}px` }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${row.collection.name}`}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <Chevron className="size-4" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {row.collection.name}
        </span>
        <span className="flex gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <IconButton label={`New page in ${row.collection.name}`} onClick={onNewPage}>
            <FilePlusIcon className="size-3.5" />
          </IconButton>
          <IconButton label={`Rename ${row.collection.name}`} onClick={onRename}>
            <PencilIcon className="size-3.5" />
          </IconButton>
          {confirming ? (
            <button
              type="button"
              onClick={onDelete}
              onBlur={() => setConfirming(false)}
              className="text-destructive shrink-0 rounded px-1 text-xs font-medium"
            >
              Confirm?
            </button>
          ) : (
            <IconButton
              label={`Delete ${row.collection.name}`}
              onClick={() => setConfirming(true)}
            >
              <Trash2Icon className="size-3.5" />
            </IconButton>
          )}
        </span>
      </li>
      {!collapsed &&
        pages.map((p) => (
          <PageRow key={p.id} page={p} indent={row.depth * 12 + 24} />
        ))}
    </>
  )
}

function UnfiledPages({ pages }: { pages: PageMeta[] }) {
  if (pages.length === 0) return null
  return (
    <>
      <li className="text-muted-foreground px-1 pt-2 text-xs font-medium tracking-wide uppercase">
        Unfiled
      </li>
      {pages.map((p) => (
        <PageRow key={p.id} page={p} indent={4} />
      ))}
    </>
  )
}

function PageRow({ page, indent }: { page: PageMeta; indent: number }) {
  const location = useLocation()
  const active = location.pathname === `/docs/${page.id}`
  return (
    <li>
      <Link
        to={`/docs/${page.id}`}
        aria-current={active ? 'page' : undefined}
        className={`${active ? 'bg-accent' : 'hover:bg-accent/40'} flex items-center gap-1.5 rounded px-1 py-1`}
        style={{ paddingLeft: `${indent}px` }}
      >
        <FileTextIcon className="text-muted-foreground size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm">{page.title}</span>
      </Link>
    </li>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5"
    >
      {children}
    </button>
  )
}

function CollectionForm({
  title,
  submitLabel,
  initialName = '',
  parents,
  onSubmit,
  onDone,
}: {
  title: string
  submitLabel: string
  initialName?: string
  /** Present only on create — a rename never re-parents. */
  parents?: readonly TreeRow[]
  onSubmit: (name: string, parentId: string | null) => Promise<void>
  onDone: () => void
}) {
  const [name, setName] = useState(initialName)
  const [parentId, setParentId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(name, parentId === '' ? null : parentId)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>

      <div className="space-y-2">
        <label htmlFor="collection-name" className="text-sm font-medium">
          Name
        </label>
        <Input
          id="collection-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Handbook"
          autoFocus
        />
      </div>

      {parents && parents.length > 0 && (
        <div className="space-y-2">
          <label htmlFor="collection-parent" className="text-sm font-medium">
            Inside <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <select
            id="collection-parent"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="">Top level</option>
            {parents.map((row) => (
              <option key={row.collection.id} value={row.collection.id}>
                {' '.repeat(row.depth * 2)}
                {row.collection.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? `${submitLabel}…` : submitLabel}
        </Button>
      </div>
    </form>
  )
}
