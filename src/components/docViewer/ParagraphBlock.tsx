import { useState, useMemo, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { DocSection, SpeakerId } from '@/types'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'
import { useSettingsStore } from '@/stores/settingsStore'
import WikiLink from './WikiLink'

interface Props {
  section: DocSection
  speaker: SpeakerId
}

/** Convert [[slug]], [[target|display]], [[target#heading]] to markdown links */
function preprocessWikiLinks(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
    const parts = inner.split('|')
    const rawTarget = parts[0].trim()
    // Strip heading anchor for node resolution; keep alias or full ref for display
    const target = rawTarget.split('#')[0].trim()
    const display = parts.length > 1 ? parts[1].trim() : rawTarget
    // Use fragment URL (#wikilink-...) — react-markdown allows fragments without sanitization
    return `[${display}](#wikilink-${encodeURIComponent(target)})`
  })
}

/**
 * Build SVG skeleton line widths from body text.
 * Each non-empty line → a bar whose width is proportional to line character count.
 * Capped at 20 lines and 98% width max.
 */
function buildSkeletonLines(body: string): number[] {
  const lines = body.split('\n').filter(l => l.trim().length > 0)
  if (lines.length === 0) return [55]
  return lines.slice(0, 20).map(line => {
    const len = line.trim().length
    // Map character count to percentage width (80 chars ≈ full width)
    return Math.min(98, Math.max(15, Math.round((len / 80) * 100)))
  })
}

function ParagraphBlock({ section, speaker }: Props) {
  const [hovered, setHovered] = useState(false)
  const speakerColor = SPEAKER_CONFIG[speaker].color
  const paragraphRenderQuality = useSettingsStore(s => s.paragraphRenderQuality)
  const isFast = paragraphRenderQuality === 'fast'

  const processedBody = useMemo(() => {
    if (paragraphRenderQuality === 'high') return preprocessWikiLinks(section.body)
    return section.body // medium/fast: raw body
  }, [section.body, paragraphRenderQuality])

  // Fast mode: SVG skeleton lines (vector-image-like, no text DOM nodes)
  const skeletonLines = useMemo(() => {
    if (!isFast) return null
    return buildSkeletonLines(section.body)
  }, [isFast, section.body])

  const bodyContent = useMemo(() => {
    if (isFast) {
      // Render as SVG vector skeleton — lightweight, no text layout
      const lines = skeletonLines!
      const svgHeight = lines.length * 13
      return (
        <svg
          width="100%"
          height={svgHeight}
          style={{ display: 'block', opacity: 0.22 }}
          aria-hidden="true"
        >
          {lines.map((w, i) => (
            <rect
              key={i}
              x={0}
              y={i * 13}
              width={`${w}%`}
              height={7}
              rx={3}
              fill="var(--color-text-secondary)"
            />
          ))}
        </svg>
      )
    }

    if (paragraphRenderQuality === 'medium') {
      return (
        <ReactMarkdown urlTransform={(url) => url}>
          {processedBody}
        </ReactMarkdown>
      )
    }

    // high: full markdown + interactive wiki-links
    return (
      <ReactMarkdown
        urlTransform={(url) => url}
        components={{
          a({ href, children }) {
            if (href?.startsWith('#wikilink-')) {
              const slug = decodeURIComponent(href.slice('#wikilink-'.length))
              return <WikiLink slug={slug} />
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}
              >
                {children}
              </a>
            )
          },
        }}
      >
        {processedBody}
      </ReactMarkdown>
    )
  }, [processedBody, paragraphRenderQuality, isFast, skeletonLines])

  return (
    <div
      className="mb-6 pl-3"
      style={{
        borderLeft: (!isFast && hovered)
          ? `2px solid ${speakerColor}`
          : '2px solid transparent',
        background: (!isFast && hovered)
          ? `${speakerColor}0d`
          : 'transparent',
        transition: isFast ? undefined : 'background 0.15s, border-color 0.15s',
        borderRadius: '0 4px 4px 0',
        padding: '4px 0 4px 12px',
      }}
      onMouseEnter={isFast ? undefined : () => setHovered(true)}
      onMouseLeave={isFast ? undefined : () => setHovered(false)}
      data-testid={`paragraph-block-${section.id}`}
      data-hovered={hovered ? 'true' : undefined}
    >
      <h2
        className="text-xs font-semibold mb-2 uppercase tracking-wide"
        style={{ color: speakerColor, letterSpacing: '0.07em', opacity: isFast ? 0.5 : 1 }}
      >
        {section.heading}
      </h2>
      <div
        className="text-sm leading-relaxed prose-vault"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {bodyContent}
      </div>
    </div>
  )
}

export default memo(ParagraphBlock)
