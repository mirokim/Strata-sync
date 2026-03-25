import { generateReportHtmlFromContent } from '@/lib/chatReportExporter'

// escapeHtml and mdToHtml are not exported, so we test them indirectly
// through generateReportHtmlFromContent which calls mdToHtml → escapeHtml

describe('chatReportExporter — generateReportHtmlFromContent', () => {
  it('returns a complete HTML document', () => {
    const html = generateReportHtmlFromContent('Hello world')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('</html>')
  })

  it('uses the provided title', () => {
    const html = generateReportHtmlFromContent('body', 'My Report')
    expect(html).toContain('My Report')
  })

  it('uses default title when none provided', () => {
    const html = generateReportHtmlFromContent('body')
    expect(html).toContain('Conversation Report')
  })

  // ── escapeHtml (tested via title injection) ─────────────────────────────

  it('escapes HTML entities in title', () => {
    const html = generateReportHtmlFromContent('body', '<script>alert("xss")</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  // ── Headings ────────────────────────────────────────────────────────────

  it('converts # heading to <h1>', () => {
    const html = generateReportHtmlFromContent('# Title')
    expect(html).toContain('<h1>Title</h1>')
  })

  it('converts ## heading to <h2>', () => {
    const html = generateReportHtmlFromContent('## Section')
    expect(html).toContain('<h2>Section</h2>')
  })

  it('converts ### heading to <h3>', () => {
    const html = generateReportHtmlFromContent('### Subsection')
    expect(html).toContain('<h3>Subsection</h3>')
  })

  // ── Lists ───────────────────────────────────────────────────────────────

  it('converts unordered list items', () => {
    const md = '- item one\n- item two'
    const html = generateReportHtmlFromContent(md)
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>item one</li>')
    expect(html).toContain('<li>item two</li>')
    expect(html).toContain('</ul>')
  })

  it('converts ordered list items', () => {
    const md = '1. first\n2. second'
    const html = generateReportHtmlFromContent(md)
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>first</li>')
    expect(html).toContain('<li>second</li>')
    expect(html).toContain('</ol>')
  })

  // ── Code blocks ─────────────────────────────────────────────────────────

  it('converts fenced code blocks to <pre><code>', () => {
    const md = '```js\nconst x = 1;\n```'
    const html = generateReportHtmlFromContent(md)
    expect(html).toContain('<pre><code>')
    expect(html).toContain('const x = 1;')
    expect(html).toContain('</code></pre>')
  })

  it('escapes HTML inside code blocks', () => {
    const md = '```\n<div>test</div>\n```'
    const html = generateReportHtmlFromContent(md)
    expect(html).toContain('&lt;div&gt;test&lt;/div&gt;')
  })

  // ── Inline formatting ──────────────────────────────────────────────────

  it('converts **bold** to <strong>', () => {
    const html = generateReportHtmlFromContent('This is **bold** text')
    expect(html).toContain('<strong>bold</strong>')
  })

  it('converts *italic* to <em>', () => {
    const html = generateReportHtmlFromContent('This is *italic* text')
    expect(html).toContain('<em>italic</em>')
  })

  it('converts `inline code` to <code>', () => {
    const html = generateReportHtmlFromContent('Use `formatTokens()` here')
    expect(html).toContain('<code>formatTokens()</code>')
  })

  // ── Tables ──────────────────────────────────────────────────────────────

  it('converts markdown tables to <table>', () => {
    const md = '| Name | Value |\n| --- | --- |\n| A | 1 |\n| B | 2 |'
    const html = generateReportHtmlFromContent(md)
    expect(html).toContain('<table>')
    expect(html).toContain('<th>Name</th>')
    expect(html).toContain('<th>Value</th>')
    expect(html).toContain('<td>A</td>')
    expect(html).toContain('<td>1</td>')
    expect(html).toContain('</table>')
  })

  // ── Blockquotes ─────────────────────────────────────────────────────────

  it('converts > blockquote to <blockquote>', () => {
    const html = generateReportHtmlFromContent('> Important note')
    expect(html).toContain('<blockquote>Important note</blockquote>')
  })

  // ── Horizontal rule ─────────────────────────────────────────────────────

  it('converts --- to <hr>', () => {
    const html = generateReportHtmlFromContent('above\n\n---\n\nbelow')
    expect(html).toContain('<hr>')
  })

  // ── Paragraphs ──────────────────────────────────────────────────────────

  it('wraps plain text in <p> tags', () => {
    const html = generateReportHtmlFromContent('Just a paragraph')
    expect(html).toContain('<p>Just a paragraph</p>')
  })
})
