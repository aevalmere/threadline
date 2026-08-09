/** Shows the right modifier for the platform, because ⌘K on Windows is Ctrl+K. */
export function AppShellSearchHint() {
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-xs">
      {isMac ? '⌘' : 'Ctrl'} K
    </kbd>
  )
}
