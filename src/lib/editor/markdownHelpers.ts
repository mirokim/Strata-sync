/**
 * Markdown editing helper functions for CodeMirror 6.
 * Obsidian-style list continuation, indentation, inline mark toggle,
 * and blockquote continuation — used as keymap handlers.
 */

import { EditorView } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'

// ── List item line detection regex ───────────────────────────────────────────

/** Regex for detecting list item lines */
export const LIST_RE = /^(\s*)([-*+]|\d+\.)( \[[ xX]\])? /

/** Ordered list: returns the number of the item directly above at a given indent level (0 if none) */
export function prevNumAtIndent(state: EditorState, fromLine: number, indentLen: number): number {
  for (let n = fromLine - 1; n >= 1; n--) {
    const text = state.doc.line(n).text
    if (text.trim() === '') continue
    const m = text.match(/^(\s*)(\d+\.)/)
    if (m) {
      const d = m[1].length
      if (d === indentLen) return parseInt(m[2])
      if (d < indentLen) return 0  // upper level — no same-level item found
    } else if (!LIST_RE.test(text)) {
      return 0  // non-list line — stop searching
    }
  }
  return 0
}

/** Tab: indent list item (+2 spaces), ordered lists recalculate number per level */
export function mdIndentList(view: EditorView): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  if (from !== to) return false
  const line = state.doc.lineAt(from)
  if (!LIST_RE.test(line.text)) return false

  // Ordered list: calculate number for new indent level
  const numM = line.text.match(/^(\s*)(\d+\.)( .*)/)
  if (numM) {
    const newIndentLen = numM[1].length + 2
    const prev = prevNumAtIndent(state, line.number, newIndentLen)
    const newNum = prev > 0 ? prev + 1 : 1
    const oldMarker = numM[2]
    const newMarker = `${newNum}.`
    const newText = `  ${numM[1]}${newMarker}${numM[3]}`
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: newText },
      selection: { anchor: from + 2 + (newMarker.length - oldMarker.length) },
      userEvent: 'input.indent',
    })
    return true
  }

  // Bullet list: add 2 spaces
  view.dispatch({
    changes: { from: line.from, insert: '  ' },
    selection: { anchor: from + 2 },
    userEvent: 'input.indent',
  })
  return true
}

/** Shift-Tab: dedent list item (-2 spaces) */
export function mdDedentList(view: EditorView): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  if (from !== to) return false
  const line = state.doc.lineAt(from)
  if (!LIST_RE.test(line.text)) return false
  const spaces = (line.text.match(/^( +)/) ?? ['', ''])[1].length
  if (spaces < 2) return false
  const remove = Math.min(2, spaces)
  view.dispatch({
    changes: { from: line.from, to: line.from + remove, insert: '' },
    selection: { anchor: Math.max(line.from, from - remove) },
    userEvent: 'delete.dedent',
  })
  return true
}

/** Enter: continue list item / exit list if item is empty */
export function mdContinueList(view: EditorView): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  if (from !== to) return false
  const line = state.doc.lineAt(from)
  const m = line.text.match(/^(\s*)([-*+]|\d+\.)( \[[ xX]\])? (.*)$/)
  if (!m) return false
  const [, indent, marker, checkbox = '', content] = m

  // Empty item + cursor at line end → exit list (remove bullet prefix)
  if (!content.trim() && from === line.to) {
    const prefixLen = indent.length + marker.length + checkbox.length + 1
    view.dispatch({
      changes: { from: line.from, to: line.from + prefixLen, insert: '' },
      selection: { anchor: line.from },
      userEvent: 'input',
    })
    return true
  }

  // Cursor is mid-line — delegate to default Enter handling
  if (from < line.to) return false

  // Ordered list: next number at same indent level
  let nextMarker = marker
  const numMatch = marker.match(/^(\d+)\.$/)
  if (numMatch) {
    const prev = prevNumAtIndent(state, line.number, indent.length)
    const base = prev > 0 ? prev : parseInt(numMatch[1])
    nextMarker = `${base + 1}.`
  }

  // Checkbox: new item starts unchecked
  const nextCheckbox = checkbox ? ' [ ]' : ''
  const newLine = `\n${indent}${nextMarker}${nextCheckbox} `

  view.dispatch({
    changes: { from, insert: newLine },
    selection: { anchor: from + newLine.length },
    userEvent: 'input',
  })
  return true
}

/** Ctrl+B / Ctrl+I: toggle inline mark (** or *) */
export function mdToggleMark(view: EditorView, mark: string): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  const mlen = mark.length

  if (from === to) {
    // No selection: insert mark pair and place cursor in between
    view.dispatch({
      changes: { from, insert: mark + mark },
      selection: { anchor: from + mlen },
      userEvent: 'input',
    })
    return true
  }

  // Already wrapped — remove the marks
  const before = state.doc.sliceString(from - mlen, from)
  const after  = state.doc.sliceString(to, to + mlen)
  if (before === mark && after === mark) {
    view.dispatch({
      changes: [
        { from: from - mlen, to: from, insert: '' },
        { from: to, to: to + mlen, insert: '' },
      ],
      selection: { anchor: from - mlen, head: to - mlen },
      userEvent: 'delete',
    })
  } else {
    view.dispatch({
      changes: [{ from, insert: mark }, { from: to, insert: mark }],
      selection: { anchor: from + mlen, head: to + mlen },
      userEvent: 'input',
    })
  }
  return true
}

/** Enter: continue blockquote (>) / exit blockquote if item is empty */
export function mdContinueBlockquote(view: EditorView): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  if (from !== to) return false
  const line = state.doc.lineAt(from)
  // Nested blockquote pattern: `> ` or `>> ` etc.
  const m = line.text.match(/^((?:> ?)+)(.*)$/)
  if (!m) return false
  const [, prefix, content] = m

  // Empty item + cursor at line end → exit blockquote (remove prefix)
  if (!content.trim() && from === line.to) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: '' },
      selection: { anchor: line.from },
      userEvent: 'input',
    })
    return true
  }

  // Cursor is mid-line — delegate to default Enter handling
  if (from < line.to) return false

  const newLine = `\n${prefix}`
  view.dispatch({
    changes: { from, insert: newLine },
    selection: { anchor: from + newLine.length },
    userEvent: 'input',
  })
  return true
}
