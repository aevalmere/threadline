# Interaction states - exact specifications

Per-component checklist. A state that is not specified here is a state that will be missing in the build.

## Contents
1. The nine states
2. Hover
3. Focus
4. Active and pressed
5. Disabled
6. Loading
7. Empty
8. Error
9. Success
10. Density and target size
11. Worked example: a button

---

## 1. The nine states

```
default -> hover -> focus -> active/pressed -> disabled -> loading -> empty -> error -> success
```

Not every component has all nine. A static card has no loading state; a data table has all of them. Decide
which apply, then specify each one that does. "It inherits the default" is a decision that must be stated,
not an omission.

## 2. Hover

```css
@media (hover: hover) and (pointer: fine) {
  .btn:hover { background: var(--action-primary-bg-hover); }
}
```

Touch devices fire synthetic hover events that persist after the tap, so an ungated hover style stays applied
until the user taps elsewhere. Never assume hover parity between mouse and touch.

Hover is never the only affordance. A control discoverable only on hover is invisible to touch and to keyboard
users.

## 3. Focus

```css
:focus-visible {
  outline: 2px solid var(--fg);
  box-shadow: 0 0 0 4px var(--bg);   /* the second ring keeps the indicator legible on any adjacent surface */
}
:focus:not(:focus-visible) { outline: none; }
```

- `:focus-visible`, not `:focus`. Bare `:focus` shows a ring on every mouse click, which is why teams delete it
  and end up with no keyboard indicator at all.
- Contrast of the indicator against adjacent colors: 3:1 minimum (WCAG 1.4.11 AA).
- Contrast between the focused and unfocused states of the same pixels: 3:1 (2.4.13, AAA but good practice).
- Indicator area at least as large as a 2 CSS-px perimeter outline around the component (2.4.13).
- The focused element must not be entirely hidden by other content (2.4.11 AA). Sticky headers and footers are
  the usual culprit. Test by tabbing the whole page with the header pinned.
- Tab order follows DOM order. If a visual reorder (flex `order`, grid placement) breaks the reading sequence,
  the DOM is wrong, not the tab order.

## 4. Active and pressed

Feedback duration 100 to 160ms. Use `transform: scale(0.98)` or a background-shift, never a layout change.
For toggles, `aria-pressed` must reflect the state; for expandable regions, `aria-expanded` plus
`aria-controls`.

## 5. Disabled

In order of preference:

1. **Do not disable submit-type actions.** Keep the button enabled, validate on click, and surface the
   specific field errors. This kills the "why is this dead" problem, where the user cannot tell what is
   missing.
2. **Hide the action entirely** when it is only valid after other steps complete.
3. When a true disabled state is unavoidable, it should read as present but unavailable, not vanish. WCAG
   exempts disabled controls from the 4.5:1 rule, which is a carve-out, not a design target.

A disabled control always needs a reason available somewhere non-hover-only. `title` is not sufficient; it is
invisible to touch.

## 6. Loading

Response-time thresholds and the feedback each demands:

| Delay | Perception | Required feedback |
|---|---|---|
| under 0.1s | instantaneous | none |
| 0.1 to 1.0s | noticeable but uninterrupted | none required; do not block input |
| 1 to 10s | "the computer is working" | busy indicator |
| over 10s | user context-switches | determinate percent-done indicator plus a cancel path |

Skeleton versus spinner: a skeleton that mirrors the final layout reduces perceived wait and prevents layout
shift when data resolves. Use it for anything loading into a predictable shape: a list, a feed, a card grid, a
profile. A spinner is fine for short waits with an unpredictable resulting shape, such as search-as-you-type,
but reads as slower than a skeleton for anything page-sized.

The pending state must also disable double submission. A form that can be submitted twice during its own
loading state is a correctness bug wearing a UI costume.

Announce loading to assistive technology: `aria-busy="true"` on the region, or a live region that announces
completion.

## 7. Empty

Three rules:

1. **State system status in plain language.** "No records for the selected date range." Not a blank void
   indistinguishable from a bug or an unfinished load.
2. **Teach.** Show what would appear here and how to make it appear: "Star a project to list it here."
3. **Give a direct path to the fix.** A real Create, Add, or Import button, not descriptive text.

Distinguish three different empties and write different copy for each: nothing exists yet (onboarding),
nothing matched this filter (offer to clear the filter), and the fetch failed (that is an error state, not an
empty state).

## 8. Error

- Inline, next to the offending field. A top-of-form summary is an addition, never the only channel.
- Never hover-only. A tooltip that must be hovered to read is inaccessible to touch and keyboard.
- Never color alone. Pair with an icon positioned left of the message. Roughly 1 in 12 men has a color vision
  deficiency, and an icon is also faster to scan for everyone.
- Validate after the user finishes the field, not on every keystroke. Flagging incomplete input as wrong
  mid-entry is its own usability bug.
- Copy names the fix: "Password needs 8+ characters", not "Invalid input".
- Three or more repeated errors on the same field is a design bug. Investigate the field and its copy; do not
  restate the message louder.
- Use `role="alert"` or `aria-live="polite"` so the message is announced, and `aria-describedby` so the field
  and its error are associated.
- Modals for errors, sparingly. They force the user to memorize the instruction before acting on it.

Server-side failures need their own copy: name what failed and what happens next. "Upload failed: file exceeds
25 MB." Not "Oops! Something went wrong."

## 9. Success

Shortest possible. "Saved." A toast is the one surface where the minimal sentence is unambiguously correct.
Announce it in a live region. Auto-dismiss only when the information is not needed again; anything the user
might need to act on stays until dismissed.

## 10. Density and target size

Row height reference scale:

| Density | Row height | Fits |
|---|---|---|
| Compact | 24px | Expert data tools with a density toggle |
| Short | 32px | Dense admin |
| Medium | 40px | Default admin |
| Default | 48px | Consumer, touch-primary |
| Tall | 64px | Marketing, media-heavy lists |

Target size floor: 24x24 CSS px (WCAG 2.5.8 AA), or 24px of clear spacing to the next target if the target is
smaller. Touch-primary surfaces should target 44x44. Cell padding starting point: 16px horizontal, 8px
vertical, tuned to the type scale in use.

Professional tools earn density with a toggle. Consumer surfaces never go below the 24px floor even in a
compact mode.

## 11. Worked example: a button

```tsx
type Props = {
  children: React.ReactNode
  pending?: boolean
  variant?: 'primary' | 'secondary'
} & React.ButtonHTMLAttributes<HTMLButtonElement>

export function Button({ children, pending = false, variant = 'primary', ...rest }: Props) {
  return (
    <button
      {...rest}
      aria-busy={pending || undefined}
      className={cn(
        'inline-flex items-center justify-center min-h-11 px-4 rounded-md text-sm font-medium',
        'transition-colors duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
        '[@media(hover:hover)and(pointer:fine)]:hover:bg-action-primary-hover',
        variant === 'primary' ? 'bg-action-primary text-on-action' : 'bg-surface-2 text-fg',
        pending && 'pointer-events-none opacity-70',
      )}
    >
      {pending ? <Spinner aria-hidden="true" /> : null}
      {children}
    </button>
  )
}
```

What this specifies, in order: a 44px minimum target height, a compositor-only transition with a
deceleration-led curve, a visible keyboard-only focus ring, hover gated to fine pointers, semantic token
colors rather than raw palette values, and a pending state that both announces itself and blocks a second
click. An icon-only variant of this button needs an `aria-label`, since `children` would carry no text.
