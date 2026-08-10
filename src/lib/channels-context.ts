import { createContext, useContext } from 'react'

import type { Channel } from '@/lib/supabase'

export interface CreateChannelInput {
  name: string
  kind: Channel['kind']
  topic?: string
}

export interface ChannelsContextValue {
  channels: Channel[] | null
  /** True until the first fetch settles. */
  loading: boolean
  /** Set when the list could not be loaded. Mutation errors are thrown instead. */
  error: string | null
  chat: Channel[]
  forum: Channel[]
  refresh: () => Promise<void>
  createChannel: (input: CreateChannelInput) => Promise<Channel>
  /** Name and topic together — both are edited in the same dialog. */
  updateChannel: (id: string, patch: { name: string; topic: string }) => Promise<void>
  deleteChannel: (id: string) => Promise<void>
}

export const ChannelsContext = createContext<ChannelsContextValue | null>(null)

export function useChannels(): ChannelsContextValue {
  const ctx = useContext(ChannelsContext)
  if (!ctx) throw new Error('useChannels must be used inside <ChannelsProvider>')
  return ctx
}
