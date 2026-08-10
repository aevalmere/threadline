import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { MenuIcon, SearchIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { AppShellSearchHint } from '@/components/layout/SearchHint'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { CurrentChannelTitle } from '@/components/layout/CurrentChannelTitle'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChannelsProvider } from '@/lib/channels'
import { ProfilesProvider } from '@/lib/profiles'

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  // Lifted so the header's search button and Ctrl/⌘K drive the same palette.
  const [paletteOpen, setPaletteOpen] = useState(false)
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
            </header>

            {/* No padding here — routes own their insets so a scroll
                container can reach the window edge and put its scrollbar
                there rather than floating 24px inside. */}
            <main className="min-h-0 flex-1 overflow-y-auto">
              <Outlet />
            </main>
          </div>

          <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} />
        </div>
      </ProfilesProvider>
    </ChannelsProvider>
  )
}
