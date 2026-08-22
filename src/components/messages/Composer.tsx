import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'

import { PaperclipIcon, SendIcon, XIcon } from 'lucide-react'

import { AuthorAvatar } from '@/components/layout/AuthorAvatar'
import { Button } from '@/components/ui/button'
import { formatBytes, validateFile } from '@/lib/attachments'
import { applyMention, matchMentions, mentionQueryAt } from '@/lib/mentions'
import { useProfiles } from '@/lib/profiles-context'
import { cn } from '@/lib/utils'

/**
 * The composer. Files are *staged*, never sent on pick — attaching something is
 * not the same gesture as sending it, and the old behaviour fired a message the
 * moment a file was chosen, with no chance to add a caption or change your
 * mind. Nothing leaves until Enter or Send.
 *
 * Staged files come from three places that all funnel into `stage()`: the
 * paperclip, a paste, and a drop on the message list.
 */
export interface ComposerHandle {
  stage: (files: File[]) => void
}

export const Composer = forwardRef<
  ComposerHandle,
  {
    channelName: string | undefined
    onSend: (body: string, files: File[]) => Promise<void>
    disabled: boolean
    placeholder?: string
    autoFocus?: boolean
    /** Nested inside a thread, so it skips the full-width composer chrome. */
    inset?: boolean
  }
>(function Composer(
  { channelName, onSend, disabled, placeholder, autoFocus, inset },
  ref,
) {
  const [value, setValue] = useState('')
  const [staged, setStaged] = useState<File[]>([])
  const [rejected, setRejected] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)

  const { byId, avatarUrlFor } = useProfiles()
  // The mention picker. `query` is null when it is closed, which is also what
  // decides whether Enter selects or sends — see onKeyDown.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [highlighted, setHighlighted] = useState(0)

  const candidates = mention ? matchMentions(mention.query, [...byId.values()]) : []
  const picking = mention !== null && candidates.length > 0

  /** Re-read the caret after any change, so the picker follows the cursor. */
  function syncMention(text: string, caret: number) {
    const found = mentionQueryAt(text, caret)
    setMention(found)
    setHighlighted(0)
  }

  function choose(username: string) {
    const el = textarea.current
    const caret = el?.selectionStart ?? value.length
    const next = applyMention(value, caret, username)
    setValue(next.text)
    setMention(null)
    // The caret has to be restored by hand: setting `value` programmatically
    // otherwise drops it at the end of the text.
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(next.caret, next.caret)
    })
  }

  const stage = useCallback((files: File[]) => {
    const ok: File[] = []
    const errors: string[] = []
    for (const f of files) {
      const check = validateFile(f)
      if (check.ok) ok.push(f)
      else errors.push(check.error)
    }
    // Set from this batch alone, so a mixed drop reports the rejected file
    // instead of the accepted one silently clearing its error.
    setRejected(errors.length > 0 ? errors.join(' ') : null)
    if (ok.length > 0) setStaged((current) => [...current, ...ok])
  }, [])

  useImperativeHandle(ref, () => ({ stage }), [stage])

  function submit() {
    if (disabled) return
    if (!value.trim() && staged.length === 0) return
    void onSend(value, staged)
    setValue('')
    setStaged([])
    setRejected(null)
    setMention(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // The picker owns these keys while it is open. Enter in particular: it
    // sends, so an open picker must intercept it or choosing a name with the
    // keyboard would fire off a half-typed message instead.
    if (picking) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted((i) => (i + 1) % candidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted((i) => (i - 1 + candidates.length) % candidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        choose(candidates[highlighted].username)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...e.clipboardData.files]
    if (files.length === 0) return
    // Let the text half of a mixed paste land in the textarea as usual; only
    // claim the event when there is nothing but files.
    if (!e.clipboardData.getData('text')) e.preventDefault()
    stage(files)
  }

  const canSend = !disabled && (value.trim().length > 0 || staged.length > 0)

  return (
    <div className={cn('relative shrink-0', inset ? 'pt-2' : 'border-t px-6 py-3')}>
      {picking && (
        // Above the textarea rather than below it: the composer sits at the
        // bottom of the viewport, so a dropdown would open off-screen.
        <ul className="bg-popover absolute bottom-full left-6 z-20 mb-1 w-64 overflow-hidden rounded-md border shadow-md">
          {candidates.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                // onMouseDown, not onClick: the textarea loses focus on
                // mousedown, and by the time click fires the caret is gone.
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(p.username)
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={cn(
                  'flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm',
                  i === highlighted && 'bg-accent',
                )}
              >
                <AuthorAvatar
                  name={p.display_name}
                  url={avatarUrlFor(p.id)}
                  className="size-5"
                />
                <span className="truncate">{p.display_name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  @{p.username}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {staged.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {staged.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="bg-muted flex items-center gap-2 rounded-md px-2 py-1"
            >
              <PaperclipIcon className="text-muted-foreground size-3.5 shrink-0" />
              <span className="max-w-48 truncate text-xs">{f.name}</span>
              <span className="text-muted-foreground text-xs">{formatBytes(f.size)}</span>
              <button
                type="button"
                onClick={() => setStaged((c) => c.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3.5" />
                <span className="sr-only">Remove {f.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {rejected && (
        <p role="alert" className="text-destructive mb-2 text-xs">
          {rejected}
        </p>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textarea}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            syncMention(e.target.value, e.target.selectionStart)
          }}
          // Clicking or arrowing elsewhere can move the caret out of (or into)
          // a mention without changing the text at all.
          onSelect={(e) => {
            const el = e.currentTarget
            syncMention(el.value, el.selectionStart)
          }}
          onBlur={() => setMention(null)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={2}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder={placeholder ?? (channelName ? `Message #${channelName}` : 'Message')}
          className="border-input placeholder:text-muted-foreground focus-visible:ring-ring/50 field-sizing-content max-h-40 min-h-16 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-60"
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => stage([...(e.target.files ?? [])])}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
        >
          <PaperclipIcon />
          <span className="sr-only">Attach a file</span>
        </Button>
        <Button type="button" size="icon" disabled={!canSend} onClick={submit}>
          <SendIcon />
          <span className="sr-only">Send</span>
        </Button>
      </div>
    </div>
  )
})
