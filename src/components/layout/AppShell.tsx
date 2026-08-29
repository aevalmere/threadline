import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { MenuIcon, SearchIcon, UsersIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { AppShellSearchHint } from '@/components/layout/SearchHint'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { CurrentChannelTitle } from '@/components/layout/CurrentChannelTitle'
import { MemberList } from '@/components/layout/MemberList'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { Resizer } from '@/components/layout/Resizer'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChannelsProvider } from '@/lib/channels'
import { readPreference, writePreference } from '@/lib/preferences'
import { ProfilesProvider } from '@/lib/profiles'
import { UnreadProvider } from '@/lib/unread-provider'
import { useIsDesktop } from '@/lib/useIsDesktop'

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  // Lifted so the header's search button and Ctrl/⌘K drive the same palette.
  const [paletteOpen, setPaletteOpen] = useState(false)
  // One flag drives both member surfaces: the docked panel at md and up, and
  // the sheet below it. Two would let the panel be open on a phone rotated to
  // landscape and shut again on the way back.
  const isDesktop = useIsDesktop()
  // Restored only on a wide viewport. The same flag drives the docked panel
  // and the mobile sheet, and restoring it on a phone would open a
  // full-screen overlay on load that nobody asked for. Closing it on a phone
  // still writes, because that is a choice; opening it there is not a
  // preference worth carrying to the desktop.
  const [membersOpen, setMembersOpenState] = useState(() =>
    isDesktop ? readPreference('membersOpen') : false,
  )
  const setMembersOpen = (open: boolean) => {
    setMembersOpenState(open)
    writePreference('membersOpen', open)
  }
  // Live width during a drag is component state; storage is written once at
  // the end of the drag rather than on every pointer frame.
  const [sidebarWidth, setSidebarWidth] = useState(() => readPreference('sidebarWidth'))
  const [membersWidth, setMembersWidth] = useState(() => readPreference('membersWidth'))
  const openPalette = () => setPaletteOpen(true)

  const commitSidebar = (width: number) => {
    setSidebarWidth(width)
    writePreference('sidebarWidth', width)
  }
  const commitMembers = (width: number) => {
    setMembersWidth(width)
    writePreference('membersWidth', width)
  }

  return (
    <ChannelsProvider>
      <ProfilesProvider>
        <UnreadProvider>
          <div className="flex h-full">
            {/* The width lands through a custom property behind the `md:`
                prefix, not as an inline `width`. Below md this aside is
                `hidden` and the sidebar is a sheet instead, and an inline
                width would follow it in there. */}
            <aside
              className="hidden shrink-0 md:block md:w-[var(--sidebar-w)]"
              style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
            >
              <Sidebar />
            </aside>
            <Resizer
              label="Resize the sidebar"
              boundKey="sidebarWidth"
              width={sidebarWidth}
              onChange={setSidebarWidth}
              onCommit={commitSidebar}
              side="left"
              className="hidden md:block"
            />

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

                <NotificationBell />

                <Button
                  variant="ghost"
                  size="icon"
                  aria-pressed={membersOpen}
                  onClick={() => setMembersOpen(!membersOpen)}
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
              <>
                <Resizer
                  label="Resize the member list"
                  boundKey="membersWidth"
                  width={membersWidth}
                  onChange={setMembersWidth}
                  onCommit={commitMembers}
                  side="right"
                />
                {/* No border-l: the Resizer above is the seam. */}
                <aside className="shrink-0" style={{ width: `${membersWidth}px` }}>
                  <MemberList />
                </aside>
              </>
            )}
            <Sheet open={membersOpen && !isDesktop} onOpenChange={setMembersOpen}>
              <SheetContent side="right" className="w-64 p-0">
                <SheetTitle className="sr-only">Members</SheetTitle>
                <MemberList />
              </SheetContent>
            </Sheet>

            <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} />
          </div>
        </UnreadProvider>
      </ProfilesProvider>
    </ChannelsProvider>
  )
}
