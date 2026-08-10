import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { MenuIcon, SearchIcon, UsersIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { AppShellSearchHint } from '@/components/layout/SearchHint'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { CurrentChannelTitle } from '@/components/layout/CurrentChannelTitle'
import { MemberList } from '@/components/layout/MemberList'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChannelsProvider } from '@/lib/channels'
import { ProfilesProvider } from '@/lib/profiles'
import { useIsDesktop } from '@/lib/useIsDesktop'

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  // Lifted so the header's search button and Ctrl/⌘K drive the same palette.
  const [paletteOpen, setPaletteOpen] = useState(false)
  // One flag drives both member surfaces: the docked panel at md and up, and
  // the sheet below it. Two would let the panel be open on a phone rotated to
  // landscape and shut again on the way back.
  const [membersOpen, setMembersOpen] = useState(false)
  const isDesktop = useIsDesktop()
  const openPalette = () => setPaletteOpen(true)

  return (
    <ChannelsProvider>
      <ProfilesProvider>
        <div className="flex h-full">
          <aside className="hidden w-64 shrink-0 md:block">
            <Sidebar />
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="md:hidden">
                    <MenuIcon />
                    <span className="sr-only">Open navigation</span>
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-64 p-0">
                  <SheetTitle className="sr-only">Navigation</SheetTitle>
                  <Sidebar onNavigate={() => setMobileOpen(false)} />
                </SheetContent>
              </Sheet>

              <CurrentChannelTitle />

              {/* The search affordance is a button, not decoration — it opens
                  the same palette Ctrl/⌘K does. */}
              <button
                type="button"
                onClick={openPalette}
                className="text-muted-foreground hover:text-foreground hover:bg-accent ml-auto flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm"
              >
                <SearchIcon className="size-4" />
                <span className="hidden sm:inline">
                  <AppShellSearchHint />
                </span>
                <span className="sr-only">Search</span>
              </button>

              <Button
                variant="ghost"
                size="icon"
                aria-pressed={membersOpen}
                onClick={() => setMembersOpen((v) => !v)}
              >
                <UsersIcon />
                <span className="sr-only">
                  {membersOpen ? 'Hide members' : 'Show members'}
                </span>
              </Button>
            </header>

            {/* No padding here — routes own their insets so a scroll
                container can reach the window edge and put its scrollbar
                there rather than floating 24px inside. */}
            <main className="min-h-0 flex-1 overflow-y-auto">
              <Outlet />
            </main>
          </div>

          {/* Docked from md up. Below that the same list opens as a sheet,
              because a 224px panel beside a phone-width message list leaves
              neither one usable. Exactly one of the two ever mounts. */}
          {membersOpen && isDesktop && (
            <aside className="w-56 shrink-0 border-l">
              <MemberList />
            </aside>
          )}
          <Sheet open={membersOpen && !isDesktop} onOpenChange={setMembersOpen}>
            <SheetContent side="right" className="w-64 p-0">
              <SheetTitle className="sr-only">Members</SheetTitle>
              <MemberList />
            </SheetContent>
          </Sheet>

          <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} />
        </div>
      </ProfilesProvider>
    </ChannelsProvider>
  )
}
