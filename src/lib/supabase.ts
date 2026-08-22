import { createClient } from '@supabase/supabase-js'

/**
 * The one Supabase client for the whole app.
 *
 * Only ever the anon key — the service_role key never reaches the browser
 * (Non-negotiable 2 and 9). Row-level security is what protects the data:
 * one blanket "authenticated can do anything" policy per table (SPEC.md §2.2).
 *
 * The in-memory mock backend that used to swap in here (DECISIONS #12) was
 * removed at Ethan's call during the beta — the real project is the only
 * backend now.
 */

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to ' +
      '.env.local for local dev, or set both in the Cloudflare Pages project ' +
      'settings for a deploy.',
  )
}

export const supabase = createClient(url, anonKey, {
  auth: {
    // Password-reset links land on /auth/callback with the code in the URL;
    // supabase-js exchanges it and persists the session. PKCE is the flow
    // those links use.
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
})

export interface Profile {
  id: string
  /** Unique handle: the sign-in identifier and the @mention key (SPEC §2.3). */
  username: string
  display_name: string
  /**
   * A **storage path** in the private `attachments` bucket, not a URL — it has
   * to be signed before it can be rendered. Null until someone uploads one.
   */
  avatar_url: string | null
  created_at: string
}

export interface Channel {
  id: string
  name: string
  kind: 'chat' | 'forum'
  topic: string | null
  created_by: string | null
  created_at: string
}
