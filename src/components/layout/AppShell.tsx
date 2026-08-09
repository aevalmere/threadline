import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { MenuIcon, SearchIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { AppShellSearchHint } from '@/components/layout/SearchHint'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChannelsProvider } from '@/lib/channels'

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <ChannelsProvider>
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

            <div className="ml-auto flex items-center gap-2">
              <span className="text-muted-foreground hidden items-center gap-1.5 text-sm sm:flex">
                <SearchIcon className="size-4" />
                <AppShellSearchHint />
              </span>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto p-6">
            <Outlet />
          </main>
        </div>

        <CommandPalette />
      </div>
    </ChannelsProvider>
  )
}
