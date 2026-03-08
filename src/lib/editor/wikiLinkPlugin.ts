/**
 * WikiLink WYSIWYG extension for CodeMirror 6.
 *
 * On lines where the cursor is absent, [[WikiLink]] syntax is replaced with a
 * rendered clickable widget (Obsidian style). On the active cursor line the raw
 * [[...]] syntax is visible for editing.
 */

import { EditorView, ViewPlugin, Decoration, WidgetType } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import type { Range } from '@codemirror/state'

// ── WikiLink Widget ───────────────────────────────────────────────────────────

export class WikiLinkWidget extends WidgetType {
  constructor(
    readonly slug: string,
    readonly display: string,
    readonly onClick: (slug: string) => void,
  ) {
    super()
  }

  toDOM() {
    const el = document.createElement('span')
    el.textContent = this.display
    el.className = 'cm-wikilink-widget'
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      this.onClick(this.slug)
    })
    return el
  }

  eq(other: WikiLinkWidget) {
    return other.slug === this.slug && other.display === this.display
  }

  ignoreEvent() { return false }
}

// ── Image Embed Widget ────────────────────────────────────────────────────────

export class ImageEmbedWidget extends WidgetType {
  constructor(
    readonly ref: string,
    readonly onClick: (ref: string) => void,
  ) {
    super()
  }

  toDOM() {
    const el = document.createElement('span')
    el.textContent = `🖼 ${this.ref}`
    el.className = 'cm-image-embed-widget'
    el.style.cursor = 'pointer'
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      this.onClick(this.ref)
    })
    return el
  }

  eq(other: ImageEmbedWidget) { return other.ref === this.ref }
  ignoreEvent() { return false }
}

// ── WikiLink ViewPlugin ───────────────────────────────────────────────────────

interface WikiLinkPluginOptions {
  /** When true, all wiki links are rendered as widgets even on the cursor line (locked/read-only mode) */
  isLockedRef?: { current: boolean }
  /** Called when ![[image.png]] embed is clicked */
  onImageClick?: (ref: string) => void
}

export function buildWikiLinkPlugin(
  onLinkClick: (slug: string) => void,
  options?: WikiLinkPluginOptions,
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = this.compute(view)
      }

      update(update: ViewUpdate) {
        // Also recompute when lock state changes (compartment effect dispatch)
        if (update.docChanged || update.selectionSet || update.viewportChanged
          || update.transactions.some(tr => tr.effects.length > 0)) {
          this.decorations = this.compute(update.view)
        }
      }

      compute(view: EditorView): DecorationSet {
        const { state } = view
        const isLocked = options?.isLockedRef?.current ?? false
        const cursorLine = state.doc.lineAt(state.selection.main.head).number
        const widgets: Range<Decoration>[] = []
        // Capture optional leading ! to distinguish ![[img]] from [[link]]
        const wikiRe = /(!?)\[\[([^\]]+)\]\]/g

        for (const { from, to } of view.visibleRanges) {
          const text = state.doc.sliceString(from, to)
          let match
          while ((match = wikiRe.exec(text)) !== null) {
            const start = from + match.index
            const end = start + match[0].length
            const isImageEmbed = match[1] === '!'
            const inner = match[2]

            // In editable mode: skip cursor line so raw syntax is visible for editing.
            // In locked mode: always render widgets (navigation only, no editing).
            if (!isLocked && state.doc.lineAt(start).number === cursorLine) continue

            if (isImageEmbed) {
              if (!options?.onImageClick) continue
              const ref = inner.trim()
              widgets.push(
                Decoration.replace({
                  widget: new ImageEmbedWidget(ref, options.onImageClick),
                }).range(start, end),
              )
            } else {
              const parts = inner.split('|')
              const slug = parts[0].split('#')[0].trim()
              const display = parts.length > 1 ? parts[1].trim() : slug
              widgets.push(
                Decoration.replace({
                  widget: new WikiLinkWidget(slug, display, onLinkClick),
                }).range(start, end),
              )
            }
          }
        }

        return Decoration.set(widgets.sort((a, b) => a.from - b.from))
      }
    },
    { decorations: (v) => v.decorations },
  )
}

// ── ==Highlight== decorator ───────────────────────────────────────────────────

export function buildHighlightPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) { this.decorations = this.compute(view) }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged)
          this.decorations = this.compute(u.view)
      }
      compute(view: EditorView): DecorationSet {
        const { state } = view
        const decs: Range<Decoration>[] = []
        const re = /==([^=\n]+)==/g
        for (const { from, to } of view.visibleRanges) {
          const text = state.doc.sliceString(from, to)
          let m
          while ((m = re.exec(text)) !== null) {
            decs.push(Decoration.mark({ class: 'cm-highlight-mark' }).range(from + m.index, from + m.index + m[0].length))
          }
        }
        return Decoration.set(decs.sort((a, b) => a.from - b.from))
      }
    },
    { decorations: v => v.decorations },
  )
}

// ── %% comment %% decorator ───────────────────────────────────────────────────

export function buildCommentPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) { this.decorations = this.compute(view) }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged)
          this.decorations = this.compute(u.view)
      }
      compute(view: EditorView): DecorationSet {
        const { state } = view
        const decs: Range<Decoration>[] = []
        const re = /%%[\s\S]*?%%/g
        for (const { from, to } of view.visibleRanges) {
          const text = state.doc.sliceString(from, to)
          let m
          while ((m = re.exec(text)) !== null) {
            decs.push(Decoration.mark({ class: 'cm-comment-mark' }).range(from + m.index, from + m.index + m[0].length))
          }
        }
        return Decoration.set(decs.sort((a, b) => a.from - b.from))
      }
    },
    { decorations: v => v.decorations },
  )
}
