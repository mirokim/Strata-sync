/**
 * CodeMirror 6 theme definitions for the Vault markdown editor.
 * Includes syntax highlighting style and the editor chrome theme.
 */

import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

// ── Markdown Syntax Highlighting ─────────────────────────────────────────────

export const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.5em', fontWeight: '700' },
  { tag: tags.heading2, fontSize: '1.35em', fontWeight: '700' },
  { tag: tags.heading3, fontSize: '1.15em', fontWeight: '600' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--color-text-muted)' },
  { tag: tags.link, color: 'var(--color-accent)' },
  { tag: tags.url, color: 'var(--color-text-muted)', fontSize: '0.9em' },
  { tag: tags.processingInstruction, color: 'var(--color-text-muted)' },
  { tag: tags.comment, color: 'var(--color-text-muted)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--color-text-muted)', fontSize: '0.85em' },
  { tag: tags.monospace, fontFamily: 'inherit', color: '#a3d977' },
])

// ── Editor Chrome Theme ───────────────────────────────────────────────────────

export const vaultTheme = EditorView.theme({
  '&': { height: '100%', background: 'transparent' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
    fontSize: '13px',
    lineHeight: '1.7',
    padding: '16px 20px',
  },
  '.cm-content': { caretColor: 'var(--color-accent)', padding: '0' },
  '.cm-line': { padding: '0', color: 'var(--color-text-secondary)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)' },
  '.cm-selectionBackground': { background: 'rgba(99,140,255,0.2)' },
  '&.cm-focused .cm-selectionBackground': { background: 'rgba(99,140,255,0.25)' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { background: 'rgba(255,255,255,0.03)' },
  '.cm-wikilink-widget': {
    color: 'var(--color-accent)',
    cursor: 'pointer',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    textDecorationColor: 'color-mix(in srgb, var(--color-accent) 50%, transparent)',
  },
  '.cm-image-embed-widget': {
    color: '#a78bfa',
    cursor: 'pointer',
    fontStyle: 'italic',
    opacity: '0.85',
  },
  '.cm-highlight-mark': {
    background: 'rgba(255, 210, 0, 0.22)',
    borderRadius: '2px',
    padding: '1px 0',
  },
  '.cm-comment-mark': {
    color: 'var(--color-text-muted)',
    opacity: '0.5',
    fontStyle: 'italic',
  },
  '&.cm-readonly .cm-content': { opacity: '0.6' },
})

// Re-export syntaxHighlighting bound to markdownHighlight for convenience
export const markdownSyntaxHighlighting = syntaxHighlighting(markdownHighlight)
