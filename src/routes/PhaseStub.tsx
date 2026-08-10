/**
 * Placeholder for a section whose phase has not landed yet. Deliberately
 * plain — visual polish is timeboxed (Non-negotiable 10) and these are all
 * replaced by real surfaces in P1–P5.
 */
export function PhaseStub({
  title,
  phase,
  what,
}: {
  title: string
  phase: string
  what: string
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-2 p-6">
      <div className="flex items-baseline gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <span className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-xs">
          {phase}
        </span>
      </div>
      <p className="text-muted-foreground text-sm">{what}</p>
    </div>
  )
}
