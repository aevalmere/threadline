// No inter.css import: the editor inherits the app font (editor.css), so
// the document reads as part of the site and the font files never download.
import '@blocknote/shadcn/style.css'
import './editor.css'

import { useEffect } from 'react'

import type { BlockNoteEditor, PartialBlock } from '@blocknote/core'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/shadcn'

import { makeUploadFile, resolveFileUrl } from '@/lib/docFiles'

/**
 * The BlockNote surface. Uncontrolled: `initialContent` is read exactly once
 * per editor instance, so the parent remounts this component (key={page.id})
 * on a page switch instead of ever feeding the document back in as a prop.
 *
 * Files: uploadFile stores under the page's storage prefix and returns the
 * PATH, which lands verbatim in the block's url prop inside body_rich;
 * resolveFileUrl signs it at render time (DECISIONS #9 — the bucket is
 * private and a baked signed URL would expire inside the document).
 */
export default function PageEditor({
  pageId,
  initial,
  onReady,
  onChange,
}: {
  pageId: string
  initial: unknown
  onReady: (editor: BlockNoteEditor) => void
  onChange: () => void
}) {
  const editor = useCreateBlockNote({
    // Never [] — BlockNote throws on an empty array; undefined means one
    // fresh paragraph. A null body_rich is the stored form of "empty".
    initialContent:
      Array.isArray(initial) && initial.length > 0
        ? (initial as PartialBlock[])
        : undefined,
    uploadFile: makeUploadFile(pageId),
    resolveFileUrl,
  })

  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])

  // theme pinned: the site is light-only, and BlockNote's default follows
  // the OS — a dark editor inside a light app was the "embed" feel.
  return <BlockNoteView editor={editor} theme="light" onChange={onChange} />
}
