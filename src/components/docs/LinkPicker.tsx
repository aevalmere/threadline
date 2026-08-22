import { useEffect, useState } from 'react'

import { FileTextIcon, ListTodoIcon } from 'lucide-react'

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { supabase } from '@/lib/supabase'

interface Pickable {
  id: string
  title: string
}

/**
 * The "Link to…" picker for the page editor — tasks and pages by title.
 * Messages have no titles to list; they arrive by pasting a Copy-link URL
 * from a message's hover bar instead. Fetches on open: the lists are small
 * and a stale picker would offer deleted targets.
 */
export function LinkPicker({
  open,
  onOpenChange,
  currentPageId,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Excluded — a page linking to itself is never what was meant. */
  currentPageId: string
  onPick: (href: string, title: string) => void
}) {
  const [tasks, setTasks] = useState<Pickable[]>([])
  const [pages, setPages] = useState<Pickable[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      const [t, p] = await Promise.all([
        supabase.from('tasks').select('id,title').order('created_at', { ascending: false }),
        supabase.from('pages').select('id,title').order('updated_at', { ascending: false }),
      ])
      if (cancelled) return
      if (t.error || p.error) {
        setError((t.error ?? p.error)?.message ?? 'Could not load link targets.')
        return
      }
      setError(null)
      setTasks((t.data ?? []) as Pickable[])
      setPages(((p.data ?? []) as Pickable[]).filter((page) => page.id !== currentPageId))
    })()
    return () => {
      cancelled = true
    }
  }, [open, currentPageId])

  function pick(href: string, title: string) {
    onOpenChange(false)
    onPick(href, title)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Link to a task or page…" />
      <CommandList>
        <CommandEmpty>{error ?? 'No matches.'}</CommandEmpty>
        {tasks.length > 0 && (
          <CommandGroup heading="Tasks">
            {tasks.map((t) => (
              <CommandItem
                key={t.id}
                value={`task ${t.title} ${t.id}`}
                onSelect={() => pick(`/tasks?t=${t.id}`, t.title)}
              >
                <ListTodoIcon /> {t.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {pages.length > 0 && (
          <CommandGroup heading="Pages">
            {pages.map((p) => (
              <CommandItem
                key={p.id}
                value={`page ${p.title} ${p.id}`}
                onSelect={() => pick(`/docs/${p.id}`, p.title)}
              >
                <FileTextIcon /> {p.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
