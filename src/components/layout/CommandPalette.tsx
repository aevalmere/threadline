import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileTextIcon, KanbanIcon, MessagesSquareIcon } from 'lucide-react'

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

/**
 * ⌘K. Navigation only for now — P5 wires the input to the search_all()
 * Postgres function and groups results by entity type (SPEC.md §3).
 */
export function CommandPalette({
  open,
  setOpen,
}: {
  open: boolean
  setOpen: (open: boolean) => void
}) {
  const navigate = useNavigate()

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

  function go(to: string) {
    setOpen(false)
    navigate(to)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search arrives in P5 — jump to a section for now…" />
      <CommandList>
        <CommandEmpty>Nothing here yet.</CommandEmpty>
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
      </CommandList>
    </CommandDialog>
  )
}
