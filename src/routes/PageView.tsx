import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { BlockNoteEditor } from '@blocknote/core'
import { Trash2Icon } from 'lucide-react'

import PageEditor from '@/components/docs/PageEditor'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth-context'
import { AUTOSAVE_DEBOUNCE_MS, type Page } from '@/lib/pages'
import { deletePageRecord, savePageRecord, syncPageLinks, usePage } from '@/lib/useDocs'

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
  const { page, missing, error } = usePage(pageId)

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

  return <PageSurface key={page.id} page={page} onChanged={onChanged} onDeleted={onDeleted} />
}

type SaveState = 'saved' | 'saving' | 'error'

function PageSurface({
  page,
  onChanged,
  onDeleted,
}: {
  page: Page
  onChanged: () => void
  onDeleted: () => void
}) {
  const { authorId } = useAuth()
  const [title, setTitle] = useState(page.title)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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

  const markDirty = useCallback(() => {
    dirty.current = true
    if (timer.current === null) {
      timer.current = setTimeout(() => void flush(), AUTOSAVE_DEBOUNCE_MS)
    }
  }, [flush])

  // Unmount flush — covers navigating to another page or out of docs. Bound
  // through a ref so this cleanup runs exactly once, at real unmount, no
  // matter how often the callbacks above are recreated.
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => {
    return () => {
      void flushRef.current()
    }
  }, [])

  const onEditorReady = useCallback((editor: BlockNoteEditor) => {
    editorRef.current = editor
  }, [])

  // Affordance only — the database keeps its blanket policy (DECISIONS #26's
  // shape). A page whose creator's account is gone unlocks for everyone.
  const canDelete = page.created_by === null || page.created_by === authorId

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-6">
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
          with the title input above. */}
      <div className="-mx-[54px]">
        <PageEditor
          pageId={page.id}
          initial={page.body_rich}
          onReady={onEditorReady}
          onChange={markDirty}
        />
      </div>
    </div>
  )
}
