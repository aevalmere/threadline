/**
 * register — the only door into the workspace.
 *
 * SPEC.md §5, DECISIONS #14. Creates an account if, and only if, the caller
 * knows the workspace's shared invite code.
 *
 * **Why this exists as a function rather than a check in the browser.** The
 * anon key ships in the client bundle and GoTrue's `signUp` is a public
 * endpoint, so a code checked in the UI stops nobody — you call the API
 * directly and skip it. The check has to run somewhere the caller cannot
 * reach, holding a secret the bundle never sees. That is this file.
 *
 * **This is only a wall while project-level signups stay DISABLED.** If they
 * are ever switched back on, `signUp` becomes a second door with no code on it
 * and this function is decoration. `scripts/seed.ts` asserts that setting on
 * every run, and fails loudly if it drifts.
 *
 * Deployed with `npx supabase functions deploy register`. The code itself is
 * set by Ethan, never by Claude, and never committed:
 *
 *   npx supabase secrets set INVITE_CODE=<long random string>
 *
 * **Nothing type-checks this file.** The tsconfigs cover `src` and `scripts`
 * only, and eslint ignores `supabase/functions` because linting Deno globals
 * and `jsr:` specifiers with the browser config reports the runtime as errors.
 * `functions deploy` bundles with esbuild, which strips types without checking
 * them. Review it as if the compiler will not save you, because it will not.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

/**
 * The accepted username shape. This rule is stated in three places — here, the
 * database (`profiles_username_format` + `slugify_username()`), and the client
 * (arriving with the `/register` UI). That cost is accepted in DECISIONS #14.
 * The database is the wall; this exists so a bad request is refused before it
 * reaches `createUser`. Change them together — including the message below,
 * which is the same rule stated to a person.
 *
 * **The last character must be alphanumeric, not just the first.** This is the
 * set of *fixed points* of `slugify_username()` — values it returns unchanged —
 * and it has to be, because `handle_new_user()` stores the slug rather than
 * what was requested. A looser rule here accepts `bob.`, stores `bob`, and
 * leaves someone holding an account they cannot sign into: `email_for_username`
 * resolves the stored name, not the typed one. Names whose slug falls under
 * three characters are worse still — the trigger discards them and derives a
 * username from the email instead.
 *
 * It also keeps the availability pre-check honest: because the requested value
 * and the stored value are identical, querying one genuinely tests the other.
 */
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,22}[a-z0-9]$/
const MIN_PASSWORD = 8

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/**
 * Length-independent comparison, so response timing does not leak the code one
 * character at a time. `crypto.subtle.timingSafeEqual` is not in Deno Deploy's
 * stable surface, so this hashes both sides to a fixed width first and then
 * compares those — equal-length inputs make the loop's timing constant.
 */
async function codeMatches(given: string, expected: string): Promise<boolean> {
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))

  const [a, b] = await Promise.all([digest(given), digest(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

interface Body {
  inviteCode?: unknown
  email?: unknown
  username?: unknown
  displayName?: unknown
  password?: unknown
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  // Trimmed: a secret set with a trailing newline would otherwise reject every
  // correct code, failing closed but presenting as a broken endpoint.
  const expected = (Deno.env.get('INVITE_CODE') ?? '').trim()
  if (!expected) {
    // Refuse rather than fall open. An unset secret with a permissive default
    // would turn this into open registration, which is the exact failure this
    // function exists to prevent.
    console.error('INVITE_CODE is not set — refusing every registration.')
    return json({ error: 'Registration is not configured yet.' }, 503)
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400)
  }
  // A body of literal `null` or `"text"` parses fine and then throws on
  // property access, which would return a 500 carrying no CORS headers.
  if (typeof body !== 'object' || body === null) {
    return json({ error: 'Expected a JSON object.' }, 400)
  }

  const inviteCode = asString(body.inviteCode)
  const email = asString(body.email).toLowerCase()
  const username = asString(body.username).toLowerCase()
  const displayName = asString(body.displayName) || username
  const password = typeof body.password === 'string' ? body.password : ''

  // The code first, and with the same flat message whatever else is wrong, so
  // this endpoint cannot be used to probe which emails or usernames exist
  // without the code in hand.
  if (!(await codeMatches(inviteCode, expected))) {
    return json({ error: 'That invite code is not right.' }, 403)
  }

  if (!email || !email.includes('@')) {
    return json({ error: 'Enter a valid email address.' }, 400)
  }
  if (!USERNAME_RE.test(username)) {
    return json(
      {
        error:
          'Usernames are 3–24 characters: letters, numbers, dots, dashes and ' +
          'underscores, starting and ending with a letter or number.',
      },
      400,
    )
  }
  if (password.length < MIN_PASSWORD) {
    return json({ error: `Use at least ${MIN_PASSWORD} characters.` }, 400)
  }

  // Service role, injected by the platform. It exists only inside this
  // function — never in the bundle, never in the repo (Non-negotiable 2, 9).
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Pre-check so the common case gets a precise message. The unique index is
  // still the authority — between this read and the insert below, someone else
  // can take the name, and the createUser error is handled for exactly that.
  const { data: taken } = await admin
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle()
  if (taken) return json({ error: 'That username is taken.' }, 409)

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    // Auto-confirmed: the invite code is the access gate, and Supabase's
    // built-in SMTP allows only a few messages an hour — which is precisely
    // when a whole team registers at once. DECISIONS #14.
    email_confirm: true,
    // handle_new_user() reads these to build the profile in one insert.
    user_metadata: { username, display_name: displayName },
  })

  if (error) {
    const message = error.message.toLowerCase()
    // Email first: "already registered" is the specific case, and checking it
    // before the generic database-error branch stops it being swallowed.
    if (message.includes('already registered') || message.includes('already been')) {
      return json({ error: 'That email already has an account.' }, 409)
    }
    if (message.includes('password')) {
      return json({ error: error.message }, 400)
    }
    // A unique-violation raised *inside* handle_new_user aborts the signup, and
    // GoTrue reports it as a flat "Database error creating new user" — the
    // SQLSTATE does not survive. So `duplicate`/`unique` may never appear, and
    // the only remaining cause of a database error on this path is the username
    // having been taken between the pre-check above and this insert. Reporting
    // that beats a generic 500 the caller can do nothing with.
    if (
      message.includes('duplicate') ||
      message.includes('unique') ||
      message.includes('database error')
    ) {
      console.error('createUser database error (likely username race):', error)
      return json({ error: 'That username is taken.' }, 409)
    }
    console.error('createUser failed:', error)
    return json({ error: 'Could not create the account.' }, 500)
  }

  // No session is returned. The client signs in immediately afterwards with
  // the password it already has, so nothing here has to mint or handle tokens.
  return json({ ok: true, username, email: data.user?.email ?? email })
})
