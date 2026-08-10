import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The one Supabase client for the whole app.
 *
 * Only ever the anon key — the service_role key never reaches the browser
 * (Non-negotiable 2 and 9). Row-level security is what protects the data:
 * one blanket "authenticated can do anything" policy per table (SPEC.md §2.2).
 */

import { mockSupabase } from '@/lib/supabase-mock'

/**
 * Offline development mode — DECISIONS #12. Everything runs in memory with no
 * network, no Docker and no cloud project. It proves the interface, never the
 * backend: no RLS, no real replication, no constraints beyond the two the mock
 * approximates.
 */
export const MOCK_BACKEND = import.meta.env.VITE_MOCK_BACKEND === 'true'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!MOCK_BACKEND && (!url || !anonKey)) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to ' +
      '.env.local for local dev, or set both in the Cloudflare Pages project ' +
      'settings for a deploy. (Or set VITE_MOCK_BACKEND=true to run offline.)',
  )
}

const realClient = MOCK_BACKEND
  ? null
  : createClient(url, anonKey, {
      auth: {
        // Magic links land on /auth/callback with the code in the URL;
        // supabase-js exchanges it and persists the session. PKCE is the flow
        // magic links use.
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    })

/**
 * The cast is a deliberate lie, and it is contained to this line: the mock
 * implements the subset of the client the app actually calls, enumerated from
 * the call sites, not the whole SupabaseClient surface. Anything the app starts
 * calling that the mock lacks fails loudly at runtime in mock mode — which is
 * the right trade for keeping every consumer above this line unchanged.
 */
export const supabase = (realClient ?? mockSupabase) as unknown as SupabaseClient

if (MOCK_BACKEND) {
  console.warn(
    '[threadline] VITE_MOCK_BACKEND is on — in-memory backend, no Supabase. ' +
      'RLS, realtime and constraints are NOT being tested. See DECISIONS #12.',
  )
}

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
