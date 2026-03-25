/**
 * MD Converter — generates Obsidian-compatible Markdown from text/metadata.
 * Used by ConverterModal (Feature 3).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConversionType = 'minutes' | 'report' | 'proposal' | 'other'

export interface ConversionMeta {
  /** Document title (used as first H2 heading) */
  title: string
  /** Speaker / director ID string */
  speaker: string
  /** ISO date string YYYY-MM-DD */
  date: string
  /** Document type for frontmatter tag */
  type: ConversionType
}

// ── MD generation ─────────────────────────────────────────────────────────────

/**
 * Generate an Obsidian-compatible Markdown string from metadata and content.
 *
 * Output format:
 * ```
 * ---
 * speaker: art_director
 * date: 2026-02-27
 * tags: [meeting]
 * type: meeting
 * ---
 *
 * ## Title
 *
 * {content}
 * ```
 */
export function generateMD(meta: ConversionMeta, content: string): string {
  const safeTitle = meta.title.trim() || 'Document'
  const safeSpeaker = meta.speaker || 'unknown'
  const safeDate = meta.date || new Date().toISOString().split('T')[0]

  const frontmatter = [
    '---',
    `speaker: ${safeSpeaker}`,
    `date: ${safeDate}`,
    `tags: [${meta.type}]`,
    `type: ${meta.type}`,
    '---',
  ].join('\n')

  const body = content.trim()

  return `${frontmatter}\n\n## ${safeTitle}\n\n${body}\n`
}

// ── File content extractors ───────────────────────────────────────────────────

/**
 * Best-effort text extraction from a DOCX file (ZIP+XML format).
 * Locates <w:t> elements inside the binary and concatenates their text content.
 */
export async function extractDocxText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  // Decode ignoring invalid bytes — the XML tags will be readable even in binary
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const raw = decoder.decode(buffer)
  // Match text between <w:t> and </w:t> tags (Word body text)
  const matches = raw.match(/<w:t[^>]*>([^<]*)<\/w:t>/g)
  if (!matches || matches.length === 0) return ''
  return matches
    .map(m => m.replace(/<w:t[^>]*>/, '').replace(/<\/w:t>/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Best-effort text extraction from a PDF file.
 * Finds text strings inside BT...ET text blocks.
 */
export async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  // PDF text is often stored as latin1/Windows-1252
  const decoder = new TextDecoder('latin1')
  const raw = decoder.decode(buffer)
  const blocks = raw.match(/BT[\s\S]*?ET/g) ?? []
  const texts: string[] = []
  for (const block of blocks) {
    // Match strings in parentheses (Tj / TJ operators)
    const strings = block.match(/\(([^)]{1,300})\)/g)
    if (strings) {
      texts.push(...strings.map(s => s.slice(1, -1)))
    }
  }
  return texts.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Best-effort text extraction from an HTML file.
 * Strips all HTML tags via DOMParser, leaving only the visible text content.
 */
export async function extractHtmlText(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const html = reader.result as string
        const parser = new DOMParser()
        const doc = parser.parseFromString(html, 'text/html')
        // Remove non-content elements
        doc.querySelectorAll('script, style, noscript, head').forEach(el => el.remove())
        const text = (doc.body?.innerText ?? doc.body?.textContent ?? '')
        resolve(text.replace(/\s+/g, ' ').trim())
      } catch {
        reject(new Error('Failed to parse HTML file'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read HTML file'))
    reader.readAsText(file, 'utf-8')
  })
}

/**
 * Read a file and return its text content.
 * Supports: .txt, .md (UTF-8 text), .html/.htm (tag-stripped), .docx (ZIP+XML best-effort), .pdf (best-effort).
 */
export async function readFileAsText(file: File): Promise<string> {
  const name = file.name.toLowerCase()

  if (name.endsWith('.txt') || name.endsWith('.md')) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsText(file, 'utf-8')
    })
  }

  if (name.endsWith('.html') || name.endsWith('.htm')) return extractHtmlText(file)
  if (name.endsWith('.docx')) return extractDocxText(file)
  if (name.endsWith('.pdf')) return extractPdfText(file)

  throw new Error('Unsupported file format (.txt .md .html .docx .pdf)')
}
