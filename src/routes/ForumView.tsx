import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { MessageSquareIcon, PlusIcon } from 'lucide-react'

import { PostDialog } from '@/components/forums/PostDialog'
import { TagChip } from '@/components/forums/TagChip'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useChannels } from '@/lib/channels-context'
import { filterByTag, type Tag } from '@/lib/posts'
import { useProfiles } from '@/lib/profiles-context'
import { usePosts } from '@/lib/usePosts'

/**
 * One forum's post list — SPEC §1.2. Posts are refetched, not subscribed
 * (SPEC §4); the comment surfaces live on `/posts/:postId`.
 */
export default function ForumView() {
  const { channelId } = useParams<{ channelId: string }>()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { channels, loading: channelsLoading } = useChannels()
  const { nameFor } = useProfiles()
  const { posts, tags, counts, error, createPost } = usePosts(channelId)
  const [creating, setCreating] = useState(false)

  const tagFilter = params.get('tag')

  // Every tag in use in this forum, for the filter bar. Unique by id — the
  // per-post lists share Tag objects only by coincidence of the fetch.
  const allTags = useMemo(() => {
    const byId = new Map<string, Tag>()
    for (const list of tags.values()) for (const t of list) byId.set(t.id, t)
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [tags])

  const channel = channels?.find((c) => c.id === channelId)

  if (!channelsLoading && !channel) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-semibold tracking-tight">Forum not found</h1>
        <p className="text-muted-foreground mt-1 text-sm">It may have been deleted.</p>
      </div>
    )
  }

  // A chat channel opened under /forums renders as chat, and vice versa —
  // the two URL spaces stay honest about kind.
  if (channel && channel.kind !== 'forum') {
    return <Navigate to={`/channels/${channel.id}`} replace />
  }

  function setTagFilter(name: string | null) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (name === null) next.delete('tag')
        else next.set('tag', name)
        return next
      },
      { replace: true },
    )
  }

  const visible = filterByTag(posts ?? [], tags, tagFilter)

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Posts</h1>
        <Button size="sm" onClick={() => setCreating(true)}>
          <PlusIcon /> New post
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {allTags.map((t) => (
            <TagChip
              key={t.id}
              tag={t}
              active={tagFilter === t.name}
              onClick={() => setTagFilter(tagFilter === t.name ? null : t.name)}
            />
          ))}
          {tagFilter !== null && (
            <button
              type="button"
              onClick={() => setTagFilter(null)}
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {posts === null ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : visible.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {posts.length === 0
            ? 'No posts yet.'
            : `No posts tagged ${tagFilter}.`}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {visible.map((post) => (
            <li key={post.id} className="px-4 py-3">
              <Link
                to={`/posts/${post.id}`}
                className="text-sm font-medium underline-offset-4 hover:underline"
              >
                {post.title}
              </Link>
              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span>{nameFor(post.author_id)}</span>
                <span>{shortDate(post.created_at)}</span>
                <span className="inline-flex items-center gap-1">
                  <MessageSquareIcon className="size-3" />
                  {counts.get(post.id) ?? 0}
                </span>
                {(tags.get(post.id) ?? []).map((t) => (
                  <TagChip
                    key={t.id}
                    tag={t}
                    active={tagFilter === t.name}
                    onClick={() => setTagFilter(tagFilter === t.name ? null : t.name)}
                  />
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <PostDialog
        open={creating}
        title="New post"
        submitLabel="Create post"
        initial={{}}
        onClose={() => setCreating(false)}
        onSubmit={async (fields) => {
          const post = await createPost(fields)
          // Land on the new post, ready for its first comment.
          navigate(`/posts/${post.id}`)
        }}
      />
    </div>
  )
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
