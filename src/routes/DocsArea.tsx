import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import {
  ChevronDownIcon,
  ChevronRightIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  Link2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  EDIT_LOCK_POLL_MS,
  flattenTree,
  type Collection,
  type PageMeta,
  type TreeRow,
} from '@/lib/pages'
import { byPosition } from '@/lib/ordering'
import { useCollections, usePages } from '@/lib/useDocs'
import { useDragClickGuard } from '@/lib/useDragClickGuard'
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

  // The tree follows other people's work: pages and collections are
  // deliberately not in the realtime publication (DECISIONS #27), so the
  // lists poll on the edit-lock cadence and refetch when the window regains
  // focus. Own mutations still refresh instantly.
  const refreshCollections = collectionsState.refresh
  const refreshPages = pagesState.refresh
  useEffect(() => {
    const tick = () => {
      void refreshCollections()
      void refreshPages()
    }
    const interval = setInterval(tick, EDIT_LOCK_POLL_MS)
    window.addEventListener('focus', tick)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', tick)
    }
  }, [refreshCollections, refreshPages])

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
    // Sort here, not just at fetch time. `reorderPage` patches `position` on
    // one row optimistically without reordering the array, so without this the
    // drop would not move anything on screen until the next poll — and worse,
    // onDragEnd below computes its from/to against siblings sorted BY
    // POSITION, so a second drag inside that window would be reading indices
    // off a list the user is not looking at and would write the inverse
    // position. `flattenTree` does the same for collections (src/lib/pages.ts).
    for (const list of grouped.values()) list.sort(byPosition)
    return grouped
  }, [pages.pages])

  const loading = collections.collections === null || pages.pages === null
  const loadError = collections.error ?? pages.error

  const { markDragged, swallowClick } = useDragClickGuard()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  /**
   * One flat sortable list for the whole tree, in render order, with the
   * entity kind prefixed onto each id. One DndContext rather than a nested
   * one per collection: the rendered tree *is* one flat `<ul>` (flattenTree
   * hands back depth-first rows with a depth number, not nested lists), so a
   * context per sibling group would mean nesting DndContexts inside each
   * other's DOM and reasoning about which one captures a drop.
   *
   * The drop handler is what enforces the sibling rule instead: a collection
   * only moves among collections sharing its parent, a page only among pages
   * in the same collection. Anything else is ignored rather than guessed at —
   * re-filing a page into another collection is `movePage`, a menu action,
   * not a drag (SPEC §1.7).
   *
   * Like the sidebar, and for the same reason, these rows carry no
   * `touch-action: none`: the row IS the drag surface, so setting it would
   * stop a finger scrolling a long tree. Reordering here is a pointer-device
   * affordance; the board sets it on its grip, which is small enough not to
   * cost the scroll anything.
   */
  const sortableIds = useMemo(() => {
    const ids: string[] = []
    for (const row of tree) {
      // A row inside a collapsed ancestor renders nothing, so it must not be
      // in the sortable list either — dnd-kit would measure a node that is
      // not there.
      if (ancestorCollapsed(row, tree, collapsed)) continue
      ids.push(`col:${row.collection.id}`)
      if (!collapsed.has(row.collection.id)) {
        for (const p of pagesByCollection.get(row.collection.id) ?? []) ids.push(`page:${p.id}`)
      }
    }
    for (const p of pagesByCollection.get(null) ?? []) ids.push(`page:${p.id}`)
    return ids
  }, [tree, collapsed, pagesByCollection])

  function onDragEnd(e: DragEndEvent) {
    markDragged()
    const { active, over } = e
    if (!over || active.id === over.id) return

    const [activeKind, activeId] = String(active.id).split(':')
    const [overKind, overId] = String(over.id).split(':')
    // A page dropped on a collection header (or the reverse) is not a move
    // anyone asked for.
    if (activeKind !== overKind) return

    if (activeKind === 'col') {
      const all = collections.collections ?? []
      const moved = all.find((c) => c.id === activeId)
      const target = all.find((c) => c.id === overId)
      if (!moved || !target || moved.parent_id !== target.parent_id) return
      const siblings = all.filter((c) => c.parent_id === moved.parent_id).sort(byPosition)
      void run(() =>
        collections.moveCollection(
          moved.parent_id,
          siblings.findIndex((c) => c.id === moved.id),
          siblings.findIndex((c) => c.id === target.id),
        ),
      )
      return
    }

    const all = pages.pages ?? []
    const moved = all.find((p) => p.id === activeId)
    const target = all.find((p) => p.id === overId)
    if (!moved || !target || moved.collection_id !== target.collection_id) return
    const siblings = all.filter((p) => p.collection_id === moved.collection_id).sort(byPosition)
    void run(() =>
      pages.reorderPage(
        moved.collection_id,
        siblings.findIndex((p) => p.id === moved.id),
        siblings.findIndex((p) => p.id === target.id),
      ),
    )
  }

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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          onDragCancel={markDragged}
        >
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
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
              swallowClick={swallowClick}
            />
          ))}
          <UnfiledPages
            pages={pagesByCollection.get(null) ?? []}
            swallowClick={swallowClick}
          />
        </ul>
        </SortableContext>
        </DndContext>
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
  // A parent_id cycle is schema-legal — the FK only checks that the parent
  // exists — which is why `flattenTree` carries a visited set. Walking up
  // without one turns that same bad data into an infinite loop during render,
  // and a hung tab is worse than a tree in the wrong order. `flattenTree`
  // surfaces cycle members at the root, so they do reach this walk.
  const seen = new Set<string>()
  while (parentId !== null && !seen.has(parentId)) {
    if (collapsed.has(parentId)) return true
    seen.add(parentId)
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
  swallowClick,
}: {
  row: TreeRow
  pages: PageMeta[]
  collapsed: boolean
  hiddenByAncestor: boolean
  onToggle: () => void
  onNewPage: () => void
  onDelete: () => void
  onRename: () => void
  swallowClick: (e: { preventDefault: () => void; stopPropagation: () => void }) => boolean
}) {
  const [confirming, setConfirming] = useState(false)
  // Before the early return: hooks cannot be conditional.
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: `col:${row.collection.id}`,
  })
  if (hiddenByAncestor) return null
  const Chevron = collapsed ? ChevronRightIcon : ChevronDownIcon

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <li
        ref={setNodeRef}
        // Opacity reveal, not display — the action buttons stay tabbable
        // (DECISIONS #24's keyboard rule).
        className={`group flex items-center gap-1 rounded px-1 py-1 ${isDragging ? 'opacity-40' : ''}`}
        style={{
          paddingLeft: `${row.depth * 12 + 4}px`,
          transform: CSS.Transform.toString(transform),
          transition,
        }}
        {...listeners}
        // Capture phase: stopping here keeps the click off the chevron and
        // the row's action buttons after a drag lands on them.
        onClickCapture={(e) => swallowClick(e)}
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
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onNewPage}>
            <FilePlusIcon /> New page
          </ContextMenuItem>
          <ContextMenuItem onSelect={onRename}>
            <PencilIcon /> Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          {/* Arms the row's inline Confirm? instead of deleting outright —
              the same two-step every destructive action here takes. */}
          <ContextMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
            <Trash2Icon /> Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {!collapsed &&
        pages.map((p) => (
          <PageRow
            key={p.id}
            page={p}
            indent={row.depth * 12 + 24}
            swallowClick={swallowClick}
          />
        ))}
    </>
  )
}

function UnfiledPages({
  pages,
  swallowClick,
}: {
  pages: PageMeta[]
  swallowClick: (e: { preventDefault: () => void; stopPropagation: () => void }) => boolean
}) {
  if (pages.length === 0) return null
  return (
    <>
      <li className="text-muted-foreground px-1 pt-2 text-xs font-medium tracking-wide uppercase">
        Unfiled
      </li>
      {pages.map((p) => (
        <PageRow key={p.id} page={p} indent={4} swallowClick={swallowClick} />
      ))}
    </>
  )
}

function PageRow({
  page,
  indent,
  swallowClick,
}: {
  page: PageMeta
  indent: number
  swallowClick: (e: { preventDefault: () => void; stopPropagation: () => void }) => boolean
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const active = location.pathname === `/docs/${page.id}`
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: `page:${page.id}`,
  })
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          ref={setNodeRef}
          className={isDragging ? 'opacity-40' : undefined}
          style={{ transform: CSS.Transform.toString(transform), transition }}
          {...listeners}
        >
          <Link
            to={`/docs/${page.id}`}
            aria-current={active ? 'page' : undefined}
            onClick={(e) => swallowClick(e)}
            className={`${active ? 'bg-accent' : 'hover:bg-accent/40'} flex items-center gap-1.5 rounded px-1 py-1`}
            style={{ paddingLeft: `${indent}px` }}
          >
            <FileTextIcon className="text-muted-foreground size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm">{page.title}</span>
          </Link>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => navigate(`/docs/${page.id}`)}>
          <FileTextIcon /> Open
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            void navigator.clipboard.writeText(
              new URL(`/docs/${page.id}`, window.location.origin).toString(),
            )
          }
        >
          <Link2Icon /> Copy link
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
