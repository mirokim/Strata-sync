/**
 * Confluence Wiki Export Converter
 *
 * Converts the {ID}_{TITLE}.html + {ID}_files/ folder structure
 * (produced by Confluence HTML export / crawlers) into Obsidian Markdown.
 *
 * - HTML  → structured Markdown via DOMParser (headings, tables, lists, images)
 * - PDF   → text via BT/ET block extraction  (existing extractPdfText)
 * - DOCX  → text via <w:t> XML extraction    (existing extractDocxText)
 * - PPTX  → text via <a:t> XML extraction    (new)
 * - XLSX  → text via <t>  XML extraction     (new)
 * - Images → listed by filename
 */

import { extractDocxText, extractPdfText } from './mdConverter'

// ── Types ─────────────────────────────────────────────────────────────────────

export type AttachmentType = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'image' | 'other'

export interface ConfluenceAttachment {
  file: File
  type: AttachmentType
}

/** A page from a local Confluence HTML export (zip/folder). */
export interface ConfluenceExportPage {
  /** Numeric Confluence page ID (from filename prefix) */
  id: string
  /** Raw title extracted from filename (after the numeric prefix) */
  title: string
  htmlFile: File
  attachments: ConfluenceAttachment[]
}

interface ParsedHtml {
  /** Text from <h1> in the HTML */
  title: string
  /** "생성:" date from .meta div (YYYY-MM-DD) */
  created: string
  /** "수정:" date from .meta div (YYYY-MM-DD) */
  modified: string
  /** Body converted to Markdown */
  content: string
}

// ── Folder scanner ────────────────────────────────────────────────────────────

/**
 * Group files from a `webkitdirectory` input into ConfluenceExportPage objects.
 *
 * Expected structure (one level deep):
 *   {ID}_{TITLE}.html          ← page body
 *   {ID}_files/                ← attachments folder
 *     image.png
 *     report.pdf
 *     slides.pptx
 */
export function parseConfluenceFolder(files: File[]): ConfluenceExportPage[] {
  const htmlFiles: File[] = []
  const attachmentFiles: File[] = []

  for (const file of files) {
    const parts = (file.webkitRelativePath || file.name).split('/')
    // Depth 2: root-level file  →  "downloaded_pages/filename.html"
    // Depth 3: sub-folder file  →  "downloaded_pages/ID_files/filename.ext"
    if (parts.length === 2 && file.name.endsWith('.html')) {
      htmlFiles.push(file)
    } else if (parts.length === 3) {
      attachmentFiles.push(file)
    }
  }

  const pages: ConfluenceExportPage[] = []

  for (const htmlFile of htmlFiles) {
    // Filename pattern: "141268286_블록 목록.html"
    const match = htmlFile.name.match(/^(\d+)_(.+)\.html$/)
    if (!match) continue

    const [, id, title] = match

    const pageAttachments: ConfluenceAttachment[] = attachmentFiles
      .filter(f => {
        const parts = (f.webkitRelativePath || f.name).split('/')
        return parts[1] === `${id}_files`
      })
      .map(f => ({ file: f, type: getAttachmentType(f.name) }))

    pages.push({ id, title, htmlFile, attachments: pageAttachments })
  }

  // Sort by numeric ID for consistent ordering
  return pages.sort((a, b) => parseInt(a.id) - parseInt(b.id))
}

export function getAttachmentType(name: string): AttachmentType {
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'docx'
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) return 'pptx'
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx'
  if (/\.(png|jpg|jpeg|gif|webp|svg|bmp|tiff)$/.test(lower)) return 'image'
  return 'other'
}

// ── HTML → Markdown ───────────────────────────────────────────────────────────

/**
 * Convert Confluence HTML export to structured Markdown.
 * Uses DOMParser to preserve headings, tables, lists, and images.
 */
export function htmlToMarkdown(html: string): ParsedHtml {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  // Extract creation/modification dates from the .meta div
  let created = ''
  let modified = ''
  const metaDiv = doc.querySelector('.meta')
  if (metaDiv) {
    const text = metaDiv.textContent ?? ''
    created = text.match(/생성:\s*([\d-]+)/)?.[1] ?? ''
    modified = text.match(/수정:\s*([\d-]+)/)?.[1] ?? ''
  }

  // Extract H1 title
  const titleEl = doc.querySelector('h1')
  const title = titleEl?.textContent?.trim() ?? ''

  // Remove non-content elements before converting
  doc.querySelectorAll('script, style, noscript, head, .meta').forEach(el => el.remove())
  titleEl?.remove()

  const content = nodeToMd(doc.body).trim()
  return { title, created, modified, content }
}

function nodeToMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? ''
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const el = node as Element
  const tag = el.tagName.toLowerCase()

  if (['script', 'style', 'noscript'].includes(tag)) return ''

  // Confluence custom image tag: <ac:image><ri:attachment ri:filename="…"/></ac:image>
  if (tag === 'ac:image') {
    // DOMParser (HTML mode) keeps colons in attribute names as-is
    const riEl =
      el.querySelector('[ri\\:filename]') ??
      Array.from(el.querySelectorAll('*')).find(e => e.hasAttribute('ri:filename'))
    const filename = riEl?.getAttribute('ri:filename') ?? ''
    return filename ? `![${filename}](${filename})\n` : ''
  }

  const ch = () => childrenToMd(el)

  switch (tag) {
    case 'h1': return `# ${ch().trim()}\n\n`
    case 'h2': return `## ${ch().trim()}\n\n`
    case 'h3': return `### ${ch().trim()}\n\n`
    case 'h4': return `#### ${ch().trim()}\n\n`
    case 'h5': return `##### ${ch().trim()}\n\n`
    case 'h6': return `###### ${ch().trim()}\n\n`

    case 'p': {
      const t = ch().trim()
      return t ? `${t}\n\n` : ''
    }

    case 'br': return '\n'
    case 'hr': return '\n---\n\n'

    case 'strong':
    case 'b': {
      const t = ch().trim()
      return t ? `**${t}**` : ''
    }

    case 'em':
    case 'i': {
      const t = ch().trim()
      return t ? `_${t}_` : ''
    }

    case 'code': return `\`${ch()}\``

    case 'pre': {
      const codeEl = el.querySelector('code')
      const text = (codeEl ?? el).textContent ?? ''
      return `\`\`\`\n${text}\n\`\`\`\n\n`
    }

    case 'a': {
      const href = el.getAttribute('href') ?? ''
      const text = ch().trim()
      if (!text) return ''
      if (!href || href.startsWith('#')) return text
      return `[${text}](${href})`
    }

    case 'img': {
      const src = el.getAttribute('src') ?? ''
      const alt = el.getAttribute('alt') ?? ''
      const filename = src.split('/').pop() ?? src
      return `![${alt || filename}](${filename})`
    }

    case 'ul': return convertList(el, false) + '\n'
    case 'ol': return convertList(el, true) + '\n'

    case 'table': return convertTable(el) + '\n'

    case 'blockquote': {
      const text = ch().trim()
      return text.split('\n').map(line => `> ${line}`).join('\n') + '\n\n'
    }

    // Pass-through containers
    case 'div':
    case 'section':
    case 'article':
    case 'main':
    case 'body':
    case 'span':
    case 'td':
    case 'th':
    case 'tr':
    case 'thead':
    case 'tbody':
    case 'tfoot':
    case 'li':
    default:
      return ch()
  }
}

function childrenToMd(el: Element): string {
  return Array.from(el.childNodes).map(c => nodeToMd(c)).join('')
}

function convertList(el: Element, ordered: boolean, depth = 0): string {
  const items = Array.from(el.children).filter(c => c.tagName.toLowerCase() === 'li')
  const indent = '  '.repeat(depth)

  return items
    .map((li, idx) => {
      const prefix = ordered ? `${idx + 1}. ` : '- '
      let text = ''
      let nestedMd = ''

      for (const child of li.childNodes) {
        const childTag = (child as Element).tagName?.toLowerCase()
        if (childTag === 'ul') { nestedMd = '\n' + convertList(child as Element, false, depth + 1); continue }
        if (childTag === 'ol') { nestedMd = '\n' + convertList(child as Element, true,  depth + 1); continue }
        text += nodeToMd(child)
      }

      return `${indent}${prefix}${text.trim()}${nestedMd}`
    })
    .join('\n')
}

function convertTable(tableEl: Element): string {
  const rows = Array.from(tableEl.querySelectorAll('tr'))
  if (rows.length === 0) return ''

  const tableData: string[][] = rows.map(row =>
    Array.from(row.querySelectorAll('th, td')).map(cell =>
      (cell.textContent ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
    )
  )

  const maxCols = Math.max(...tableData.map(r => r.length))
  if (maxCols === 0) return ''

  const pad = (row: string[]) => [...row, ...Array(maxCols - row.length).fill('')]
  const header = pad(tableData[0])
  const separator = header.map(() => '---')
  const body = tableData.slice(1).map(pad)

  return [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...body.map(row => `| ${row.join(' | ')} |`),
  ].join('\n') + '\n'
}

// ── Attachment text extractors ────────────────────────────────────────────────

/**
 * Text extraction from PPTX using JSZip.
 * Decompresses ZIP, reads ppt/slides/slide*.xml, extracts <a:t> elements.
 */
export async function extractPptxText(file: File): Promise<string> {
  const JSZip = (await import('jszip')).default
  const buffer = await file.arrayBuffer()
  let zip: InstanceType<typeof JSZip>
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    return ''
  }
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort()
  const parts: string[] = []
  for (const name of slideFiles) {
    const xml = await zip.file(name)!.async('string')
    const texts = (xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? [])
      .map(m => m.replace(/<a:t[^>]*>/, '').replace(/<\/a:t>/, '').trim())
      .filter(Boolean)
    if (texts.length) parts.push(texts.join(' '))
  }
  return parts.join('\n').replace(/\s+/g, ' ').trim()
}

/**
 * Text extraction from XLSX using JSZip.
 * Reads xl/sharedStrings.xml for string values.
 */
export async function extractXlsxText(file: File): Promise<string> {
  const JSZip = (await import('jszip')).default
  const buffer = await file.arrayBuffer()
  let zip: InstanceType<typeof JSZip>
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    return ''
  }
  const ssFile = zip.file('xl/sharedStrings.xml')
  if (!ssFile) return ''
  const xml = await ssFile.async('string')
  return (xml.match(/<t[^>]*>([^<]*)<\/t>/g) ?? [])
    .map(m => m.replace(/<t[^>]*>/, '').replace(/<\/t>/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Page converter ────────────────────────────────────────────────────────────

/** Max characters of attachment text to include per attachment */
const MAX_ATTACH_CHARS = 3000

/**
 * Convert a single ConfluenceExportPage to an Obsidian-compatible Markdown string.
 * Includes HTML body + extracted text from document attachments.
 */
export async function convertConfluenceExportPage(page: ConfluenceExportPage): Promise<string> {
  // Read HTML file
  const htmlContent = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('HTML 읽기 실패'))
    reader.readAsText(page.htmlFile, 'utf-8')
  })

  const { title, created, modified, content } = htmlToMarkdown(htmlContent)
  const finalTitle = title || page.title

  // Build Obsidian frontmatter
  const frontmatter = [
    '---',
    `source: confluence`,
    `confluence_id: "${page.id}"`,
    `title: "${finalTitle.replace(/"/g, "'")}"`,
    `date: ${created || new Date().toISOString().split('T')[0]}`,
    ...(modified && modified !== created ? [`modified: ${modified}`] : []),
    `speaker: unknown`,
    `tags: [기타]`,
    `type: 기타`,
    '---',
  ].join('\n')

  let md = `${frontmatter}\n\n## ${finalTitle}\n\n${content}`

  // Categorise attachments
  const docAttachments = page.attachments.filter(a =>
    ['pdf', 'docx', 'pptx', 'xlsx'].includes(a.type)
  )
  const imgAttachments = page.attachments.filter(a => a.type === 'image')

  if (docAttachments.length > 0 || imgAttachments.length > 0) {
    md += '\n\n---\n\n### 📎 첨부파일\n\n'

    if (imgAttachments.length > 0) {
      md += `**이미지 (${imgAttachments.length}개)**\n\n`
      md += imgAttachments.map(a => `- \`${a.file.name}\``).join('\n') + '\n\n'
    }

    for (const att of docAttachments) {
      md += `#### 📄 ${att.file.name}\n\n`
      try {
        let text = ''
        if (att.type === 'pdf')  text = await extractPdfText(att.file)
        if (att.type === 'docx') text = await extractDocxText(att.file)
        if (att.type === 'pptx') text = await extractPptxText(att.file)
        if (att.type === 'xlsx') text = await extractXlsxText(att.file)

        if (text.trim()) {
          md += text.slice(0, MAX_ATTACH_CHARS)
          if (text.length > MAX_ATTACH_CHARS) md += '\n\n_(내용 일부 생략)_'
          md += '\n\n'
        } else {
          md += '_텍스트 추출 불가_\n\n'
        }
      } catch {
        md += '_변환 실패_\n\n'
      }
    }
  }

  return md
}
