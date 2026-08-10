import { useEffect, useState } from 'react'

/** Tailwind v4's `md`. Kept as one constant so JS and CSS cannot disagree. */
const MD = '(min-width: 48rem)'

/**
 * True at `md` and up.
 *
 * Needed where a surface is a docked panel on a wide screen and a sheet on a
 * narrow one. Doing that with `hidden md:block` alone does not work: a Radix
 * sheet renders a full-screen overlay in a portal, so hiding only its *content*
 * at `md` still dims the page behind a panel that is already visible. The
 * choice has to be made in JS, before either one mounts.
 */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => window.matchMedia(MD).matches)

  useEffect(() => {
    const mq = window.matchMedia(MD)
    const onChange = () => setDesktop(mq.matches)
    // Re-read on mount too: the width can change between the initial render
    // and the effect, and the listener only fires on the *next* crossing.
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return desktop
}
