import { createClient } from '@supabase/supabase-js'

/**
 * The one Supabase client for the whole app.
 *
 * Only ever the anon key — the service_role key never reaches the browser
 * (Non-negotiable 2 and 9). Row-level security is what protects the data:
 * one blanket "authenticated can do anything" policy per table (SPEC.md §2.2).
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
    // Magic links land on /auth/callback with the code in the URL; supabase-js
    // exchanges it and persists the session. PKCE is the flow magic links use.
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
})

export interface Profile {
  id: string
  display_name: string
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
