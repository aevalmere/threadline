import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import type { BlockNoteEditor } from '@blocknote/core'
import { Link2Icon, PencilLineIcon, Trash2Icon } from 'lucide-react'

import { LinkedItems } from '@/components/LinkedItems'
import { LinkPicker } from '@/components/docs/LinkPicker'
import PageEditor from '@/components/docs/PageEditor'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth-context'
import {
  AUTOSAVE_DEBOUNCE_MS,
  EDIT_LOCK_POLL_MS,
  HEARTBEAT_INTERVAL_MS,
  editingBanner,
  type Page,
} from '@/lib/pages'
import { useProfiles } from '@/lib/profiles-context'
import {
  claimEdit,
  deletePageRecord,
  releaseEdit,
  savePageRecord,
  syncPageLinks,
  usePage,
} from '@/lib/useDocs'

/**
 * One doc page — SPEC §1.7. The route shell owns the fetch, the not-found
 * state, and the load error; PageSurface (keyed by page id, so a switch
 * remounts the uncontrolled editor) owns the title, the autosave latch, and
 * the delete affordance.
 */
export default function PageView({
  onChanged,
  onDeleted,
}: {
  /** The sidebar list shows titles — re-fetched after a save changes one. */
  onChanged: () => void
  onDeleted: () => void
}) {
  const { pageId } = useParams<{ pageId: string }>()
  const { page, missing, error, refreshLock } = usePage(pageId)

  if (missing) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">
          This page is gone — deleted, or the link is stale.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <p role="alert" className="text-destructive text-sm">
          Could not load the page: {error}
        </p>
      </div>
    )
  }

  if (page === null) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <PageSurface
      key={page.id}
      page={page}
      refreshLock={refreshLock}
      onChanged={onChanged}
      onDeleted={onDeleted}
    />
  )
}

type SaveState = 'saved' | 'saving' | 'error'

function PageSurface({
  page,
  refreshLock,
  onChanged,
  onDeleted,
}: {
  page: Page
  refreshLock: () => Promise<void>
  onChanged: () => void
  onDeleted: () => void
}) {
  const { authorId } = useAuth()
  const { nameFor } = useProfiles()
  const navigate = useNavigate()
  const [title, setTitle] = useState(page.title)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  const titleRef = useRef(page.title)
  const editorRef = useRef<BlockNoteEditor | null>(null)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef(false)

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (!dirty.current || inFlight.current) return
    inFlight.current = true
    setSaveState('saving')
    try {
      // Loop: a keystroke landing while the save is in flight re-dirties, and
      // the re-save must not wait for another latch.
      while (dirty.current) {
        dirty.current = false
        const doc = editorRef.current !== null ? editorRef.current.document : page.body_rich
        await savePageRecord(page.id, titleRef.current, doc)
        await syncPageLinks(page.id, doc)
      }
      setSaveState('saved')
      setSaveError(null)
      onChanged()
    } catch (err) {
      dirty.current = true
      setSaveState('error')
      setSaveError(err instanceof Error ? err.message : 'Could not save.')
    } finally {
      inFlight.current = false
    }
  }, [page.id, page.body_rich, onChanged])

  // The soft edit-lock (SPEC §1.7). Claimed on the FIRST content change —
  // viewing never claims — then refreshed every HEARTBEAT_INTERVAL_MS while
  // this page stays open. Fire-and-forget: a missed beat only degrades the
  // banner, and the interval retries.
  const claimed = useRef(false)
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null)
  const authorRef = useRef(authorId)
  authorRef.current = authorId

  const markDirty = useCallback(() => {
    dirty.current = true
    if (timer.current === null) {
      timer.current = setTimeout(() => void flush(), AUTOSAVE_DEBOUNCE_MS)
    }
    const me = authorRef.current
    if (!claimed.current && me !== null) {
      claimed.current = true
      void claimEdit(page.id, me)
      heartbeat.current = setInterval(() => void claimEdit(page.id, me), HEARTBEAT_INTERVAL_MS)
    }
  }, [flush, page.id])

  // Readers poll the lock columns so the banner tracks reality within one
  // poll period — pages are deliberately not in the realtime publication.
  useEffect(() => {
    const poll = setInterval(() => void refreshLock(), EDIT_LOCK_POLL_MS)
    return () => clearInterval(poll)
  }, [refreshLock])

  // Unmount flush — covers navigating to another page or out of docs. Bound
  // through a ref so this cleanup runs exactly once, at real unmount, no
  // matter how often the callbacks above are recreated.
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => {
    // page.id never changes for a mounted PageSurface (the parent keys on
    // it), so this still runs exactly once per page.
    const pageId = page.id
    return () => {
      void flushRef.current()
      if (heartbeat.current !== null) clearInterval(heartbeat.current)
      // Release only a claim we hold — the .eq guard inside releaseEdit also
      // keeps a stale unmount from clobbering a teammate's newer claim.
      if (claimed.current && authorRef.current !== null) {
        void releaseEdit(pageId, authorRef.current)
      }
    }
  }, [page.id])

  const onEditorReady = useCallback((editor: BlockNoteEditor) => {
    editorRef.current = editor
  }, [])

  /**
   * Internal links stay in the SPA. Bubble phase on purpose: BlockNote's own
   * handlers (caret placement, link toolbar) run first and preventDefault —
   * only a click the browser would actually navigate on is claimed here.
   */
  const onEditorClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.defaultPrevented) return
      const anchor = (e.target as HTMLElement).closest('a')
      if (anchor === null) return
      const href = anchor.getAttribute('href')
      if (href === null) return
      let path: string | null = null
      if (href.startsWith('/')) path = href
      else if (href.startsWith(window.location.origin + '/')) {
        path = href.slice(window.location.origin.length)
      }
      if (path === null) return
      e.preventDefault()
      navigate(path)
    },
    [navigate],
  )

  // Affordance only — the database keeps its blanket policy (DECISIONS #26's
  // shape). A page whose creator's account is gone unlocks for everyone.
  const canDelete = page.created_by === null || page.created_by === authorId

  // Re-evaluated on every render; the poll's setPage keeps renders coming, so
  // a stale claim drops within one poll period.
  const editingUserId = editingBanner(page, authorId, Date.now())

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-6">
      {editingUserId !== null && (
        <div
          role="status"
          className="bg-muted text-muted-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <PencilLineIcon className="size-4 shrink-0" />
          {nameFor(editingUserId)} is editing this page
        </div>
      )}
      <div className="flex items-center gap-3">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            titleRef.current = e.target.value
            markDirty()
          }}
          aria-label="Page title"
          placeholder="Untitled"
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-2xl font-semibold tracking-tight outline-none"
        />
        <span
          className={`shrink-0 text-xs ${saveState === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
          role={saveState === 'error' ? 'alert' : undefined}
        >
          {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Link to a task or page"
          title="Link to a task or page"
          onClick={() => setPicking(true)}
        >
          <Link2Icon />
        </Button>
        {canDelete &&
          (confirmingDelete ? (
            <Button
              size="sm"
              variant="destructive"
              onBlur={() => setConfirmingDelete(false)}
              onClick={() => {
                void (async () => {
                  try {
                    await deletePageRecord(page.id)
                    onDeleted()
                  } catch (err) {
                    setDeleteError(
                      err instanceof Error ? err.message : 'Could not delete the page.',
                    )
                    setConfirmingDelete(false)
                  }
                })()
              }}
            >
              Confirm delete
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              aria-label="Delete page"
              title="Delete page"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2Icon />
            </Button>
          ))}
      </div>

      {saveState === 'error' && saveError && (
        <p className="text-destructive text-xs">{saveError} Edits are kept — typing retries.</p>
      )}
      {deleteError && (
        <p role="alert" className="text-destructive text-xs">
          {deleteError}
        </p>
      )}

      {/* -mx-* pulls BlockNote's gutter back so its content edge lines up
          with the title input above. The onClick is delegation for anchors
          the editor renders — the links themselves stay keyboard-reachable
          through the editor. */}
      <div className="-mx-[54px]" onClick={onEditorClick}>
        <PageEditor
          pageId={page.id}
          initial={page.body_rich}
          onReady={onEditorReady}
          onChange={markDirty}
        />
      </div>

      <LinkedItems targetType="page" targetId={page.id} />

      <LinkPicker
        open={picking}
        onOpenChange={setPicking}
        currentPageId={page.id}
        onPick={(href, linkTitle) => {
          const editor = editorRef.current
          if (editor === null) return
          editor.focus()
          editor.insertInlineContent(
            [{ type: 'link', href, content: linkTitle }, ' '],
            { updateSelection: true },
          )
          markDirty()
        }}
      />
    </div>
  )
}
