// TipTap rich-text field. Server-renders the editor (RSC), accepts
// JSON output. Used by every long-form input: product long_description,
// FAQ answer, blog body, legal page body, partner bio. Admin and
// partner forms use this — never markdown.
//
// AGENTS.md rule 1 ("end products"): users edit in WYSIWYG. No
// markdown textarea, ever, for content that will be rendered to
// users.

'use client'

import { useEditor, EditorContent, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { useEffect } from 'react'
import styles from './RichTextField.module.css'

export type RichTextFieldProps = {
  name: string // hidden form input name; the JSON is stringified here
  initialContent: JSONContent | null
  placeholder?: string
  /** When set, the editor uses this controlled value (controlled mode). */
  value?: JSONContent | null
  onChange?: (value: JSONContent) => void
  disabled?: boolean
  /** Min-height in px. Default 220. */
  minHeight?: number
  /** If true, includes headings (h2, h3) in the toolbar. */
  allowHeadings?: boolean
  /** If true, includes the link button. Default true. */
  allowLinks?: boolean
}

export function RichTextField({
  name,
  initialContent,
  placeholder = 'Start writing…',
  value,
  onChange,
  disabled,
  minHeight = 220,
  allowHeadings = false,
  allowLinks = true,
}: RichTextFieldProps) {
  const extensions = [StarterKit.configure({ heading: allowHeadings ? { levels: [2, 3] } : false })]
  if (allowLinks) extensions.push(Link.configure({ openOnClick: false, autolink: true }) as any)

  const editor = useEditor({
    extensions,
    content: value ?? initialContent ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: styles.editor ?? '',
        'data-placeholder': placeholder ?? '',
        'aria-label': 'Rich text editor',
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON()
      onChange?.(json)
    },
  })

  // Controlled-mode sync: when the parent updates `value`, reflect it.
  useEffect(() => {
    if (!editor) return
    if (value && JSON.stringify(value) !== JSON.stringify(editor.getJSON())) {
      editor.commands.setContent(value, false)
    }
  }, [editor, value])

  if (!editor) return null

  return (
    <div className={styles.wrap} style={{ minHeight }}>
      <input
        type="hidden"
        name={name}
        value={JSON.stringify(value ?? editor.getJSON() ?? initialContent ?? { type: 'doc' })}
      />
      <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={editor.isActive('bold') ? styles.btnActive : styles.btn}
          aria-pressed={editor.isActive('bold')}
          aria-label="Bold"
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={editor.isActive('italic') ? styles.btnActive : styles.btn}
          aria-pressed={editor.isActive('italic')}
          aria-label="Italic"
        >
          <em>I</em>
        </button>
        {allowHeadings && (
          <>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={editor.isActive('heading', { level: 2 }) ? styles.btnActive : styles.btn}
              aria-pressed={editor.isActive('heading', { level: 2 })}
              aria-label="Heading 2"
            >
              H2
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              className={editor.isActive('heading', { level: 3 }) ? styles.btnActive : styles.btn}
              aria-pressed={editor.isActive('heading', { level: 3 })}
              aria-label="Heading 3"
            >
              H3
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={editor.isActive('bulletList') ? styles.btnActive : styles.btn}
          aria-pressed={editor.isActive('bulletList')}
          aria-label="Bullet list"
        >
          •
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={editor.isActive('orderedList') ? styles.btnActive : styles.btn}
          aria-pressed={editor.isActive('orderedList')}
          aria-label="Numbered list"
        >
          1.
        </button>
        {allowLinks && (
          <button
            type="button"
            onClick={() => {
              const url = window.prompt('Enter URL')
              if (!url) return
              editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
            }}
            className={editor.isActive('link') ? styles.btnActive : styles.btn}
            aria-pressed={editor.isActive('link')}
            aria-label="Link"
          >
            ⎘
          </button>
        )}
        <button
          type="button"
          onClick={() => editor.chain().focus().undo().run()}
          className={styles.btn}
          aria-label="Undo"
          disabled={!editor.can().undo()}
        >
          ↶
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().redo().run()}
          className={styles.btn}
          aria-label="Redo"
          disabled={!editor.can().redo()}
        >
          ↷
        </button>
      </div>
      <EditorContent editor={editor} className={styles.editorHost} />
    </div>
  )
}
