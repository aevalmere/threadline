---
name: webforge-ui
description: >-
  Builds components, layouts, forms, and navigation with every interaction state specified and accessibility
  built in rather than retrofitted: hover, focus-visible, disabled, loading, empty, error, plus labels, alt
  text, contrast, and keyboard order. Use when asked to build or fix a page, component, form, modal, table, or
  any visible surface. Use this even when the user does not name it. Not for server logic, caching, or auth;
  use webforge-server.
metadata:
  pack: webforge
  kind: specialist
  domain: frontend,design
  version: "1.0.0"
---

# WebForge UI
Builds the client surface. Called by `webforge-orchestrator` after `webforge-taste` has written the constraint
block, or directly for a single component.

## Activation receipt

Standing rule for the rest of this session, every turn, not just the first:

Whenever this skill's guidance shapes your response, end the reply with exactly one line, after a blank
line, as the last thing in the visible output:

    [skills: name1 > name2]

List every skill that fired this turn, FORGE or not, in the order it fired, by its full name. If this skill
ran alone, write `[skills: webforge-ui only]`. If a skill you intended to call was not on disk, add one
short parenthetical: `[skills: webforge-ui (<missing-skill> absent)]`.

Never write a second such line, a heading above it, a banner, or any explanation of it. Never put it inside a
code fence. This line is the only permitted trace of the machinery; everything else about phases, defect
logs, and refinement cycles stays hidden.

## When called by the orchestrator

Take the stack posture and the `DESIGN.md` constraint block as fixed input. Do not redesign the palette, type
scale, or spacing; build to them. Verify only what changed: the installed Zod major and whether the target
file is already a Client Component.

## When invoked directly

Read `package.json` for the `react`, `next`, and `zod` majors and check whether a `DESIGN.md` or token file
exists before writing markup. If none exists, pick tokens from the surrounding code rather than inventing a
new scale, and say which file you copied them from.

## Definition of done for any component

All six states specified before the component is called done. Not "handled somewhere", specified: named
classes or props, visible in a story or a test.

1. **hover** - gated behind `@media (hover: hover) and (pointer: fine)`. Touch devices fire synthetic hover
   that sticks after a tap.
2. **focus-visible** - `:focus-visible`, never bare `:focus`. Indicator at least a 2px perimeter outline,
   3:1 contrast against adjacent colors, and not obscured by a sticky header (WCAG 2.4.11 AA).
3. **disabled** - preferably avoided. Keep submit actions enabled and validate on attempt, or hide an action
   that is not yet valid, rather than shipping a dead control whose reason is invisible.
4. **loading** - keyed to expected response time. Under 0.1s: nothing. 0.1 to 1s: do not block input.
   1 to 10s: a busy indicator. Over 10s: a determinate progress indicator plus a cancel path. Use a skeleton
   that mirrors the final layout when the shape is predictable; a spinner only for short unpredictable waits.
5. **empty** - states what is missing in plain language, teaches what would appear here, and gives a real
   button that fixes it. "No projects yet. Create one." with a Create button, not a blank panel.
6. **error** - inline next to the offending field, never hover-only, never color alone (icon left of the
   message), validated after the field is finished rather than per keystroke, and specific: "Password needs
   8+ characters", not "Invalid input".

## The six accessibility failures that account for most real-world breakage

Present on 83 to 96 percent of real home pages. Each is a BLOCKER, not a nice-to-have.

| Failure | Rule |
|---|---|
| Low contrast | Body 4.5:1, large text (24px regular or 18.66px bold) 3:1, UI boundaries and focus rings 3:1. Not rounded: 4.499:1 fails |
| Missing `alt` | Every `<img>` has `alt`. Decorative images get `alt=""`. A linked image's alt is the link's purpose |
| Unlabeled input | Every input has a `<label htmlFor>` or an `aria-label`. Placeholder text is not a label |
| Empty link | Every `<a>` has discernible text. An icon-only link needs an accessible name |
| Empty button | Every `<button>` has an accessible name |
| Missing `lang` | `<html lang="en">` on the root layout |

WCAG 2.2 criteria added since 2.1 that apply to ordinary product UI:

- **2.5.8 Target Size (AA)**: interactive targets at least 24x24 CSS px, padding counts. An icon-only close or
  hamburger button whose glyph is 16px still needs a 24px hit area. Touch-primary surfaces should go to 44px.
- **2.4.11 Focus Not Obscured (AA)**: a focused element must not be entirely hidden behind a sticky header or
  footer. Test by tabbing with the header pinned.
- **2.5.7 Dragging Movements (AA)**: any drag-only interaction needs a non-drag alternative.
- **3.3.8 Accessible Authentication (AA)**: login must not block paste into the password field and must work
  with a password manager. Puzzle CAPTCHAs fail this.
- **3.3.7 Redundant Entry (A)**: do not force re-entry of information already given earlier in a flow.

## Server and client boundary

Default is a Server Component. Add `'use client'` only at the smallest interactive leaf. Putting it at the top
of a page or layout because one child needs `onClick` drags the entire subtree into the client bundle; that is
the single most common architectural defect in App Router code.

Keep data-fetching ancestors as Server Components and pass data or Server Actions down as props. Client
Components render once on the server for initial HTML, so they must run identically in both environments: no
server-only imports, no privileged data.

## Forms

Default: native `<form>` plus a Server Action plus `useActionState` plus Zod. It works without JavaScript and
with it.

```tsx
'use client'
import { useActionState } from 'react'
import { signup } from '@/actions/auth'

export function SignupForm() {
  const [state, action, pending] = useActionState(signup, undefined)
  return (
    <form action={action}>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="email" required
             aria-describedby={state?.errors?.email ? 'email-error' : undefined} />
      {state?.errors?.email && <p id="email-error" role="alert">{state.errors.email}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Creating...' : 'Create account'}</button>
    </form>
  )
}
```

`useFormStatus` reads the nearest **ancestor** `<form>`. Calling it in the same component that renders the
`<form>` always reports `pending: false`. Put the status-reading component inside the form.

**Zod major gate.** Check `package.json` before writing a schema. v4 uses `{ error: '...' }`; v3 uses
`{ message: '...' }`. v4 also moved string formats to the top level: `z.email()`, `z.uuid()`, `z.url()` rather
than `z.string().email()`. Generating v3 syntax against a v4 install is a silent, common failure.

Reach for react-hook-form only when the form has genuine client complexity: live per-field validation, field
arrays, cross-field dependent logic. It costs bundle size and gives up zero-JS operation.

Client validation is UX sugar. The server validates every time, without exception.

## Layout and structure rules

- One focal point per screen or section. If nothing is emphasized, the eye falls back to F-pattern scanning.
- Front-load the meaningful word in headings and links: "Pricing", not "Click here to learn about pricing".
- Heading levels never skip. `h1` to `h3` breaks screen-reader navigation.
- Measure caps at 65ch by default; 80 characters is the hard ceiling.
- Grid collapses 12 to 8 to 4 rather than becoming a new system per breakpoint.
- Use `100dvh` or `100svh`, never bare `100vh`: mobile browser chrome resizes `vh` mid-scroll.
- Minimum 16px horizontal padding on content; nothing flush against the viewport edge.

## Component library decision

| Situation | Choice |
|---|---|
| Dialog, dropdown, combobox, tooltip, popover needing focus trap, ARIA roles, keyboard nav | shadcn/ui on Base UI or Radix. Hand-rolling correct focus management is a top source of WCAG failures and is not worth re-deriving |
| Brand-defining visual design that off-the-shelf components fight | Hand-roll on top of the headless primitive directly. Keep the accessibility engine, discard the visual layer |
| A styled button or a badge | Hand-roll. A dependency for trivial markup is overhead |
| One design system across React and Vue and Svelte | Ark UI |

shadcn's default primitive has been Base UI since July 2026; Radix remains fully supported via
`shadcn init -b radix`. Detect which one an existing repo installed by checking for `@radix-ui/*` versus
`@base-ui-components/*`. Do not assume from install date.

## Quality checklist

- [ ] Every component built this turn has all six states specified at a named location.
- [ ] Every `<img>` has `alt`, every input has a label, every button and link has an accessible name.
- [ ] `<html lang>` is set on the root layout.
- [ ] Every interactive target is at least 24x24 CSS px including padding.
- [ ] `:focus-visible` is used, and a tab pass with the sticky header pinned never hides the focused element.
- [ ] `'use client'` appears only at interactive leaves, never on a route root or layout.
- [ ] Zod syntax matches the installed major, confirmed by reading `package.json`.
- [ ] No contrast pair was eyeballed; each was measured.
- [ ] The page renders correctly with JavaScript disabled, or the reason it cannot is stated.

## Interop

Defer to a project-local component-library, design-system, or form skill when one exists, and compose with it:
it owns which component to use and how it looks, this skill owns states, accessibility, and the client
boundary. Name it in the receipt line. If the rest of the pack is absent, this skill runs standalone.

## Reference files

| File | Read when |
|---|---|
| `references/interaction-states.md` | Building a component and needing the exact per-state specification |
