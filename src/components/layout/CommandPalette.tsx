import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileTextIcon,
  KanbanIcon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
} from 'lucide-react'

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_GROUPS,
  groupResults,
  jumpPathFor,
  queryReady,
  splitSnippet,
  type SearchEntityType,
  type SearchResult,
} from '@/lib/search'
import { supabase } from '@/lib/supabase'

const GROUP_ICONS: Record<SearchEntityType, typeof FileTextIcon> = {
  message: MessagesSquareIcon,
  post: MessageSquareTextIcon,
  page: FileTextIcon,
  task: KanbanIcon,
}

/**
 * ⌘K — the one search box (SPEC §1.10). The input drives search_all() on a
 * latched 300ms debounce; the server ranks, so cmdk's own filtering is off.
 * An empty (or too-short) query keeps the navigation shortcuts.
 */
export function CommandPalette({
  open,
  setOpen,
}: {
  open: boolean
  setOpen: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const queryRef = useRef(query)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Responses can land out of order; only the newest request may paint.
  const seq = useRef(0)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(!open)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, setOpen])

  const runSearch = useCallback(async () => {
    timer.current = null
    const q = queryRef.current.trim()
    if (!queryReady(q)) return
    const mySeq = ++seq.current
    const { data, error: err } = await supabase.rpc('search_all', { q })
    if (mySeq !== seq.current) return
    if (err) {
      setError(err.message)
      setResults([])
      return
    }
    setError(null)
    setResults((data ?? []) as SearchResult[])
  }, [])

  function onQueryChange(value: string) {
    setQuery(value)
    queryRef.current = value
    if (!queryReady(value)) {
      // Below the threshold nothing is in flight worth keeping.
      seq.current++
      if (timer.current !== null) {
        clearTimeout(timer.current)
        timer.current = null
      }
      setResults(null)
      setError(null)
      return
    }
    if (timer.current === null) {
      timer.current = setTimeout(() => void runSearch(), SEARCH_DEBOUNCE_MS)
    }
  }

  function close() {
    setOpen(false)
    setQuery('')
    queryRef.current = ''
    setResults(null)
    setError(null)
    seq.current++
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  function go(to: string) {
    close()
    navigate(to)
  }

  const searching = queryReady(query)
  const grouped = groupResults(results ?? [])

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => (o ? setOpen(true) : close())}
      shouldFilter={!searching}
      title="Search"
      description="Search messages, posts, pages, and tasks"
    >
      <CommandInput
        value={query}
        onValueChange={onQueryChange}
        placeholder="Search everything…"
      />
      <CommandList>
        {searching ? (
          <>
            <CommandEmpty>
              {error !== null
                ? `Search failed: ${error}`
                : results === null
                  ? 'Searching…'
                  : 'No matches.'}
            </CommandEmpty>
            {SEARCH_GROUPS.map(({ type, label }) => {
              const rows = grouped.get(type)
              if (!rows || rows.length === 0) return null
              const Icon = GROUP_ICONS[type]
              return (
                <CommandGroup key={type} heading={label}>
                  {rows.map((row) => {
                    const to = jumpPathFor(row)
                    if (to === null) return null
                    return (
                      <CommandItem
                        key={`${row.entity_type}:${row.entity_id}`}
                        value={`${row.entity_type}:${row.entity_id}`}
                        onSelect={() => go(to)}
                      >
                        <Icon className="shrink-0" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{row.title}</span>
                          <span className="text-muted-foreground truncate text-xs">
                            {splitSnippet(row.snippet).map((seg, i) =>
                              seg.match ? (
                                <span key={i} className="bg-primary/20 text-foreground rounded-[2px]">
                                  {seg.text}
                                </span>
                              ) : (
                                <span key={i}>{seg.text}</span>
                              ),
                            )}
                          </span>
                        </span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )
            })}
          </>
        ) : (
          <>
            <CommandEmpty>Nothing here.</CommandEmpty>
            <CommandGroup heading="Go to">
              <CommandItem onSelect={() => go('/channels')}>
                <MessagesSquareIcon /> Channels
              </CommandItem>
              <CommandItem onSelect={() => go('/forums')}>
                <MessagesSquareIcon /> Forums
              </CommandItem>
              <CommandItem onSelect={() => go('/docs')}>
                <FileTextIcon /> Docs
              </CommandItem>
              <CommandItem onSelect={() => go('/tasks')}>
                <KanbanIcon /> Tasks
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
