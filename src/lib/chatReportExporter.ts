// TODO: Wire up — currently not imported by any consumer
/**
 * chatReportExporter.ts — Convert conversation content to HTML for PDF export
 *
 * generateReportHtmlFromContent(markdown, title?) — Convert LLM-written markdown report to HTML
 * generateReportHtml(messages, title?)            — Convert raw chat messages to bubble-style HTML
 *
 * Passed to Electron main process's printToPDF().
 */

import type { ChatMessage } from '@/types'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'

// ── Markdown → HTML conversion (for LLM responses) ─────────────────────────

function renderInline(html: string): string {
  return html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

/**
 * Converts LLM-output markdown to an HTML fragment.
 * Supports headings, lists, tables, code blocks, blockquotes, and HR.
 */
function mdToHtml(rawMd: string): string {
  // 1. Extract code blocks → replace with placeholders (prevent internal escaping)
  const codeBlocks: string[] = []
  const md = rawMd.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
    const escaped = escapeHtml(code.replace(/\n$/, ''))
    codeBlocks.push(`<pre><code>${escaped}</code></pre>`)
    return `@@CODE${codeBlocks.length - 1}@@`
  })

  const lines = md.split('\n')
  const out: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let inTable = false
  let tableRows: string[][] = []
  let tableHeader: string[] = []
  let paraLines: string[] = []

  const flushPara = () => {
    if (!paraLines.length) return
    const text = paraLines.join('\n').trim()
    if (text) out.push(`<p>${renderInline(escapeHtml(text)).replace(/\n/g, '<br>')}</p>`)
    paraLines = []
  }

  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null }
  }

  const flushTable = () => {
    if (!inTable) return
    const headHtml = tableHeader.map(c => `<th>${renderInline(escapeHtml(c))}</th>`).join('')
    const bodyHtml = tableRows.map(row =>
      `<tr>${row.map(c => `<td>${renderInline(escapeHtml(c))}</td>`).join('')}</tr>`
    ).join('')
    out.push(`<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`)
    inTable = false; tableHeader = []; tableRows = []
  }

  const parseCells = (line: string) =>
    line.split('|').slice(1, -1).map(c => c.trim())

  const isSeparatorRow = (line: string) =>
    /^\|[-: |]+\|$/.test(line.trim())

  const isTableRow = (line: string) =>
    /^\|.+\|$/.test(line.trim())

  for (const rawLine of lines) {
    const line = rawLine

    // Code block placeholder
    if (/^@@CODE\d+@@$/.test(line.trim())) {
      flushPara(); closeList(); flushTable()
      const m = line.match(/@@CODE(\d+)@@/)
      if (m) out.push(codeBlocks[parseInt(m[1])])
      continue
    }

    // Table
    if (isTableRow(line)) {
      if (isSeparatorRow(line)) continue
      flushPara(); closeList()
      if (!inTable) { tableHeader = parseCells(line); inTable = true }
      else { tableRows.push(parseCells(line)) }
      continue
    } else if (inTable) {
      flushTable()
    }

    // Headings
    const h3 = line.match(/^### (.+)/)
    if (h3) { flushPara(); closeList(); out.push(`<h3>${renderInline(escapeHtml(h3[1]))}</h3>`); continue }
    const h2 = line.match(/^## (.+)/)
    if (h2) { flushPara(); closeList(); out.push(`<h2>${renderInline(escapeHtml(h2[1]))}</h2>`); continue }
    const h1 = line.match(/^# (.+)/)
    if (h1) { flushPara(); closeList(); out.push(`<h1>${renderInline(escapeHtml(h1[1]))}</h1>`); continue }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) { flushPara(); closeList(); out.push('<hr>'); continue }

    // Blockquote
    const bq = line.match(/^> (.+)/)
    if (bq) { flushPara(); closeList(); out.push(`<blockquote>${renderInline(escapeHtml(bq[1]))}</blockquote>`); continue }

    // Unordered list
    const ul = line.match(/^[-*] (.+)/)
    if (ul) {
      flushPara()
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul' }
      out.push(`<li>${renderInline(escapeHtml(ul[1]))}</li>`)
      continue
    }

    // Ordered list
    const ol = line.match(/^\d+\. (.+)/)
    if (ol) {
      flushPara()
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol' }
      out.push(`<li>${renderInline(escapeHtml(ol[1]))}</li>`)
      continue
    }

    // Blank line
    if (line.trim() === '') { flushPara(); closeList(); continue }

    // Regular text
    if (listType) closeList()
    paraLines.push(line)
  }

  flushPara(); closeList(); flushTable()
  return out.join('\n')
}

/** Standalone HTML shell with cover page + CSS */
function reportShell(title: string, bodyContent: string): string {
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    font-size: 13px; line-height: 1.75; color: #1e293b; background: #fff;
  }
  .cover {
    width: 100%; min-height: 240px;
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%);
    color: #f1f5f9; padding: 48px 56px 40px;
    break-after: page; position: relative; overflow: hidden;
  }
  .cover::after {
    content: ''; position: absolute; top: -60px; right: -60px;
    width: 300px; height: 300px; border-radius: 50%;
    background: radial-gradient(circle, #3b82f622 0%, transparent 70%);
  }
  .cover-tag { font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: #64748b; margin-bottom: 16px; }
  .cover-title { font-size: 26px; font-weight: 700; color: #f8fafc; margin-bottom: 8px; line-height: 1.3; }
  .cover-date { font-size: 12px; color: #94a3b8; }

  .body { padding: 40px 56px; max-width: 900px; margin: 0 auto; }

  h1 { font-size: 20px; font-weight: 700; color: #0f172a; margin: 28px 0 12px; border-bottom: 2px solid #3b82f6; padding-bottom: 6px; }
  h2 { font-size: 17px; font-weight: 700; color: #1e3a5f; margin: 24px 0 10px; }
  h3 { font-size: 14px; font-weight: 700; color: #334155; margin: 18px 0 8px; }
  p { margin: 8px 0; }
  ul, ol { margin: 8px 0 8px 24px; }
  li { margin: 4px 0; }
  blockquote {
    border-left: 3px solid #3b82f6; background: #eff6ff;
    margin: 12px 0; padding: 8px 14px; color: #1e40af; border-radius: 0 6px 6px 0;
  }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 20px 0; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 12px; }
  th { background: #1e293b; color: #f1f5f9; padding: 8px 12px; text-align: left; font-weight: 600; }
  td { padding: 7px 12px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  pre { background: #0f172a; color: #e2e8f0; padding: 14px 16px; border-radius: 6px; margin: 12px 0; font-size: 12px; overflow-x: auto; }
  code { background: #f1f5f9; color: #be185d; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
  pre code { background: transparent; color: inherit; padding: 0; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  .footer { margin-top: 48px; padding-top: 14px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
</style>
</head>
<body>
<div class="cover">
  <div class="cover-tag">Strata Sync · Report</div>
  <div class="cover-title">${escapeHtml(title)}</div>
  <div class="cover-date">${dateStr}</div>
</div>
<div class="body">
  ${bodyContent}
  <div class="footer">Strata Sync — Generated ${dateStr}</div>
</div>
</body>
</html>`
}

/**
 * Converts an LLM-written markdown report to standalone HTML for PDF export.
 */
export function generateReportHtmlFromContent(
  markdownContent: string,
  title = 'Conversation Report',
): string {
  const bodyHtml = mdToHtml(markdownContent)
  return reportShell(title, bodyHtml)
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Basic markdown rendering: bold, italic, inline code, line breaks */
function renderMarkdown(text: string): string {
  return escapeHtml(text)
    // code block (``` ... ```) — process first
    .replace(/```[\s\S]*?```/g, (m) => {
      const inner = m.slice(3, -3).replace(/^[^\n]*\n?/, '') // strip language hint
      return `<pre><code>${inner}</code></pre>`
    })
    // inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // line breaks
    .replace(/\n/g, '<br>')
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function buildMessageHtml(msg: ChatMessage): string {
  const isUser = msg.role === 'user'
  const cfg = SPEAKER_CONFIG[msg.role === 'assistant' ? msg.persona : 'chief_director']
  const color = isUser ? '#94a3b8' : cfg.color
  const label = isUser ? 'User' : cfg.label
  const time = formatTime(msg.timestamp)
  const contentHtml = renderMarkdown(msg.content)

  if (isUser) {
    return `
      <div class="msg msg-user">
        <div class="bubble bubble-user">${contentHtml}</div>
        <div class="meta-user">
          <span class="time">${time}</span>
          <span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${label}</span>
        </div>
      </div>`
  }

  return `
    <div class="msg msg-assistant">
      <div class="avatar" style="background:${cfg.darkBg};border:1.5px solid ${color}44">
        <span style="color:${color};font-weight:700;font-size:11px">${label}</span>
      </div>
      <div class="bubble-wrap">
        <div class="persona-label" style="color:${color}">${label} <span class="role-desc">${cfg.role}</span></div>
        <div class="bubble bubble-assistant" style="border-left:3px solid ${color}">${contentHtml}</div>
        <div class="time" style="margin-top:4px">${time}</div>
      </div>
    </div>`
}

export function generateReportHtml(
  messages: ChatMessage[],
  title = 'Conversation Report',
): string {
  const nonEmpty = messages.filter(m => m.content.trim() && !m.streaming)
  if (nonEmpty.length === 0) return ''

  const dateStr = nonEmpty.length > 0 ? formatDate(nonEmpty[0].timestamp) : ''
  const endDate = nonEmpty.length > 1 ? formatDate(nonEmpty[nonEmpty.length - 1].timestamp) : dateStr
  const dateRange = dateStr === endDate ? dateStr : `${dateStr} — ${endDate}`

  // Participating persona summary
  const personaSet = new Set(nonEmpty.filter(m => m.role === 'assistant').map(m => m.persona))
  const personaSummary = [...personaSet]
    .map(p => {
      const cfg = SPEAKER_CONFIG[p]
      return `<span class="persona-chip" style="background:${cfg.darkBg};color:${cfg.color};border:1px solid ${cfg.color}33">${cfg.label}</span>`
    })
    .join(' ')

  const messagesHtml = nonEmpty.map(buildMessageHtml).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    font-size: 13px;
    line-height: 1.7;
    color: #1e293b;
    background: #ffffff;
    padding: 0;
  }

  /* ── Cover page ── */
  .cover {
    width: 100%;
    min-height: 260px;
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%);
    color: #f1f5f9;
    padding: 48px 56px 40px;
    break-after: page;
    position: relative;
    overflow: hidden;
  }
  .cover::after {
    content: '';
    position: absolute;
    top: -60px; right: -60px;
    width: 300px; height: 300px;
    border-radius: 50%;
    background: radial-gradient(circle, #3b82f622 0%, transparent 70%);
    pointer-events: none;
  }
  .cover-tag {
    font-size: 10px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #64748b;
    margin-bottom: 16px;
  }
  .cover-title {
    font-size: 26px;
    font-weight: 700;
    color: #f8fafc;
    margin-bottom: 12px;
    line-height: 1.3;
  }
  .cover-date {
    font-size: 12px;
    color: #94a3b8;
    margin-bottom: 20px;
  }
  .persona-chips { display: flex; gap: 8px; flex-wrap: wrap; }
  .persona-chip {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 99px;
    font-size: 11px;
    font-weight: 600;
  }

  /* ── Conversation body ── */
  .body {
    padding: 32px 48px;
    max-width: 860px;
    margin: 0 auto;
  }

  .section-title {
    font-size: 11px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #94a3b8;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 8px;
    margin-bottom: 24px;
  }

  /* ── Message bubbles ── */
  .msg {
    display: flex;
    align-items: flex-start;
    margin-bottom: 20px;
    gap: 10px;
  }

  /* User — right-aligned */
  .msg-user {
    flex-direction: column;
    align-items: flex-end;
  }
  .bubble-user {
    background: #1e40af;
    color: #eff6ff;
    padding: 10px 14px;
    border-radius: 16px 4px 16px 16px;
    max-width: 72%;
    word-break: break-word;
  }
  .meta-user {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
  }

  /* Assistant — left-aligned */
  .msg-assistant { align-items: flex-start; }
  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .bubble-wrap { flex: 1; min-width: 0; }
  .persona-label {
    font-size: 11px;
    font-weight: 700;
    margin-bottom: 4px;
  }
  .role-desc {
    font-weight: 400;
    color: #94a3b8;
    margin-left: 4px;
  }
  .bubble-assistant {
    background: #f8fafc;
    color: #1e293b;
    padding: 10px 14px;
    border-radius: 4px 16px 16px 16px;
    max-width: 86%;
    word-break: break-word;
    border: 1px solid #e2e8f0;
  }

  /* Common */
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 99px;
    font-size: 10px;
    font-weight: 700;
  }
  .time { font-size: 10px; color: #94a3b8; }

  pre {
    background: #0f172a;
    color: #e2e8f0;
    padding: 12px 14px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 8px 0;
    font-size: 12px;
  }
  code {
    background: #f1f5f9;
    color: #be185d;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 12px;
  }
  pre code { background: transparent; color: inherit; padding: 0; }

  strong { font-weight: 700; }
  em { font-style: italic; }

  /* ── Footer ── */
  .footer {
    margin-top: 40px;
    padding-top: 16px;
    border-top: 1px solid #e2e8f0;
    font-size: 10px;
    color: #94a3b8;
    text-align: center;
  }
</style>
</head>
<body>

<div class="cover">
  <div class="cover-tag">Strata Sync · Conversation Report</div>
  <div class="cover-title">${escapeHtml(title)}</div>
  <div class="cover-date">${dateRange} · ${nonEmpty.length} messages</div>
  <div class="persona-chips">${personaSummary}</div>
</div>

<div class="body">
  <div class="section-title">Conversation</div>
  ${messagesHtml}
  <div class="footer">
    Strata Sync — Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
  </div>
</div>

</body>
</html>`
}
