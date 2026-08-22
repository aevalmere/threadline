/**
 * Forum post state — SPEC §1.2, §2.3.
 *
 * A hook, not a context: only the forum routes consume posts, the same test
 * DECISIONS #6 applied to messages and tasks. No realtime — SPEC §4 names
 * what replicates and posts are deliberately absent; the list refetches after
 * mutations, like the task board.
 *
 * The list is three queries, not a join: the mock backend has no embedded
 * selects (DECISIONS #12), and two extra round trips on a 5–30 person forum
 * are nothing. Error convention matches useTasks: the load error is state,
 * mutation errors are thrown for the calling form to catch.
 */

import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import {
  POST_COLUMNS,
  TAG_COLUMNS,
  commentCounts,
  postInsertPayload,
  postPatch,
  tagColor,
  tagDiff,
  tagsByPost,
  type Post,
  type Tag,
} from '@/lib/posts'
import { supabase } from '@/lib/supabase'

const BUCKET = 'attachments'

/** Postgres unique_violation — two clients racing to create the same tag. */
const UNIQUE_VIOLATION = '23505'

/**
 * Resolve tag names to `tags` rows, creating the ones that do not exist yet.
 * Insert-then-reselect on 23505: the loser of a creation race adopts the
 * winner's row, which `tagColor`'s determinism makes identical anyway.
 * Sequential per-row inserts — tag counts are tiny and the mock has no bulk
 * insert.
 */
export async function ensureTags(names: readonly string[]): Promise<Tag[]> {
  if (names.length === 0) return []
  const existing = await supabase.from('tags').select(TAG_COLUMNS).in('name', [...names])
  if (existing.error) throw new Error(existing.error.message)
  const byName = new Map((existing.data as Tag[]).map((t) => [t.name, t]))

  for (const name of names) {
    if (byName.has(name)) continue
    const ins = await supabase
      .from('tags')
      .insert({ name, color: tagColor(name) })
      .select(TAG_COLUMNS)
      .single()
    if (ins.data) {
      byName.set(name, ins.data as Tag)
      continue
    }
    if (ins.error?.code !== UNIQUE_VIOLATION) {
      throw new Error(ins.error?.message ?? `Could not create tag "${name}".`)
    }
    const won = await supabase.from('tags').select(TAG_COLUMNS).eq('name', name).single()
    if (won.error || !won.data) throw new Error(won.error?.message ?? `Tag "${name}" vanished.`)
    byName.set(name, won.data as Tag)
  }
  return names.map((n) => byName.get(n) as Tag)
}

export function usePosts(channelId: string | undefined) {
  /** Null until the first fetch settles — the loading state. */
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [tags, setTags] = useState<Map<string, Tag[]>>(new Map())
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const { authorId } = useAuth()

  const refresh = useCallback(async () => {
    if (!channelId) return
    const list = await supabase
      .from('posts')
      .select(POST_COLUMNS)
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
    if (list.error) {
      setError(list.error.message)
      return
    }
    const fetched = (list.data ?? []) as Post[]
    const ids = fetched.map((p) => p.id)

    let byPost = new Map<string, Tag[]>()
    let byCount = new Map<string, number>()
    if (ids.length > 0) {
      const [pt, comments] = await Promise.all([
        supabase.from('post_tags').select('post_id,tag_id').in('post_id', ids),
        supabase
          .from('messages')
          .select('post_id')
          .in('post_id', ids)
          .is('deleted_at', null),
      ])
      if (pt.error || comments.error) {
        setError((pt.error ?? comments.error)?.message ?? 'Could not load the forum.')
        return
      }
      const ptRows = (pt.data ?? []) as { post_id: string; tag_id: string }[]
      const tagIds = [...new Set(ptRows.map((r) => r.tag_id))]
      let tagRows: Tag[] = []
      if (tagIds.length > 0) {
        const tg = await supabase.from('tags').select(TAG_COLUMNS).in('id', tagIds)
        if (tg.error) {
          setError(tg.error.message)
          return
        }
        tagRows = (tg.data ?? []) as Tag[]
      }
      byPost = tagsByPost(ptRows, tagRows)
      byCount = commentCounts((comments.data ?? []) as { post_id: string | null }[])
    }

    setError(null)
    setPosts(fetched)
    setTags(byPost)
    setCounts(byCount)
  }, [channelId])

  useEffect(() => {
    // Channel switch: drop the previous forum's page so its posts never
    // render under the new forum's heading while the fetch is in flight.
    setPosts(null)
    setError(null)
    void refresh()
  }, [refresh])

  const createPost = useCallback(
    async (fields: { title: string; body: string; tagNames: string[] }): Promise<Post> => {
      if (!channelId || !authorId) throw new Error('Not ready to post yet.')
      const ins = await supabase
        .from('posts')
        .insert(postInsertPayload({ channelId, authorId, ...fields }))
        .select(POST_COLUMNS)
        .single()
      if (ins.error || !ins.data) {
        throw new Error(ins.error?.message ?? 'Could not create the post.')
      }
      const post = ins.data as Post
      const resolved = await ensureTags(fields.tagNames)
      for (const tag of resolved) {
        const pt = await supabase.from('post_tags').insert({ post_id: post.id, tag_id: tag.id })
        if (pt.error) throw new Error(`Post created, but tagging failed: ${pt.error.message}`)
      }
      await refresh()
      return post
    },
    [channelId, authorId, refresh],
  )

  const updatePost = useCallback(
    async (id: string, fields: { title: string; body: string; tagNames: string[] }) => {
      const { data, error: err } = await supabase
        .from('posts')
        .update(postPatch(fields))
        .eq('id', id)
        .select('id')
      // Judged on rows, not error absence (DECISIONS #5).
      if (err || (data?.length ?? 0) !== 1) {
        throw new Error(err?.message ?? 'The update did not take effect.')
      }
      const diff = tagDiff(tags.get(id) ?? [], fields.tagNames)
      const added = await ensureTags(diff.add)
      for (const tag of added) {
        const pt = await supabase.from('post_tags').insert({ post_id: id, tag_id: tag.id })
        if (pt.error) throw new Error(pt.error.message)
      }
      if (diff.remove.length > 0) {
        const del = await supabase
          .from('post_tags')
          .delete()
          .eq('post_id', id)
          .in('tag_id', diff.remove)
        if (del.error) throw new Error(del.error.message)
      }
      await refresh()
    },
    [tags, refresh],
  )

  const deletePost = useCallback(
    async (id: string) => {
      // Deleting a post cascades its comment rows in the database — which
      // would orphan their files, because attachments have no FK (SPEC §1.8).
      // DECISIONS #11's promise is that deletion frees the bytes, so the
      // sweep happens here, storage objects first (the failure that leaves
      // bytes behind is the one worth avoiding), then rows, then the post.
      // Re-running Delete after a partial failure is safe: remove() is
      // idempotent and every query below tolerates already-gone rows.
      const comments = await supabase.from('messages').select('id').eq('post_id', id)
      if (comments.error) throw new Error(comments.error.message)
      const ownerIds = (comments.data ?? []).map((m) => String((m as { id: number }).id))

      const owned: { id: string; storage_path: string }[] = []
      if (ownerIds.length > 0) {
        const rows = await supabase
          .from('attachments')
          .select('id,storage_path')
          .eq('owner_type', 'message')
          .in('owner_id', ownerIds)
        if (rows.error) throw new Error(rows.error.message)
        owned.push(...((rows.data ?? []) as typeof owned))
      }
      const postOwned = await supabase
        .from('attachments')
        .select('id,storage_path')
        .eq('owner_type', 'post')
        .eq('owner_id', id)
      if (postOwned.error) throw new Error(postOwned.error.message)
      owned.push(...((postOwned.data ?? []) as typeof owned))

      if (owned.length > 0) {
        const rm = await supabase.storage.from(BUCKET).remove(owned.map((a) => a.storage_path))
        if (rm.error) throw new Error(`Could not delete attached files: ${rm.error.message}`)
        const del = await supabase
          .from('attachments')
          .delete()
          .in('id', owned.map((a) => a.id))
        if (del.error) throw new Error(del.error.message)
      }

      // Links integrity is app-enforced (SPEC §1.8): a deleted post takes its
      // edges with it, both directions, same as deleteTask — edges first so a
      // failure part-way leaves a deletable post, never a dangling edge.
      // Comments and post_tags cascade in the database.
      for (const [typeCol, idCol] of [
        ['source_type', 'source_id'],
        ['target_type', 'target_id'],
      ] as const) {
        const { error: linkErr } = await supabase
          .from('links')
          .delete()
          .eq(typeCol, 'post')
          .eq(idCol, id)
        if (linkErr) throw new Error(linkErr.message)
      }
      const { data, error: err } = await supabase
        .from('posts')
        .delete()
        .eq('id', id)
        .select('id')
      if (err || (data?.length ?? 0) !== 1) {
        throw new Error(err?.message ?? 'The delete did not take effect.')
      }
      await refresh()
    },
    [refresh],
  )

  return { posts, tags, counts, error, refresh, createPost, updatePost, deletePost }
}

/**
 * One post plus its tags, for the post page. `missing` distinguishes "gone"
 * (deleted or bad URL — show not-found) from a load error.
 */
export function usePost(postId: string | undefined) {
  const [post, setPost] = useState<Post | null>(null)
  const [postTags, setPostTags] = useState<Tag[]>([])
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!postId) return
    const { data, error: err } = await supabase
      .from('posts')
      .select(POST_COLUMNS)
      .eq('id', postId)
      .maybeSingle()
    if (err) {
      setError(err.message)
      return
    }
    if (!data) {
      setMissing(true)
      return
    }
    const pt = await supabase.from('post_tags').select('tag_id').eq('post_id', postId)
    if (pt.error) {
      setError(pt.error.message)
      return
    }
    const tagIds = (pt.data ?? []).map((r) => (r as { tag_id: string }).tag_id)
    let tagRows: Tag[] = []
    if (tagIds.length > 0) {
      const tg = await supabase.from('tags').select(TAG_COLUMNS).in('id', tagIds)
      if (tg.error) {
        setError(tg.error.message)
        return
      }
      tagRows = ((tg.data ?? []) as Tag[]).sort((a, b) => a.name.localeCompare(b.name))
    }
    setError(null)
    setMissing(false)
    setPost(data as Post)
    setPostTags(tagRows)
  }, [postId])

  useEffect(() => {
    setPost(null)
    setPostTags([])
    setMissing(false)
    setError(null)
    void refresh()
  }, [refresh])

  return { post, postTags, missing, error, refresh }
}
