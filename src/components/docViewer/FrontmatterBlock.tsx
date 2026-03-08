import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { MockDocument } from '@/types'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'

interface Props {
  doc: MockDocument
}

export default function FrontmatterBlock({ doc }: Props) {
  const [open, setOpen] = useState(false)
  const speakerMeta = SPEAKER_CONFIG[doc.speaker]

  return (
    <div
      className="mb-6 rounded"
      style={{
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg-secondary)',
        fontSize: 12,
      }}
      data-testid="frontmatter-block"
    >
      {/* Toggle header */}
      <button
        className="flex items-center gap-2 w-full px-3 py-2 hover:bg-[var(--color-bg-hover)] transition-colors"
        style={{ color: 'var(--color-text-muted)' }}
        onClick={() => setOpen(o => !o)}
        data-testid="frontmatter-toggle"
        aria-expanded={open}
      >
        {open
          ? <ChevronDown size={12} />
          : <ChevronRight size={12} />
        }
        <span style={{ fontFamily: 'monospace' }}>frontmatter</span>
        <span style={{ marginLeft: 'auto', color: speakerMeta.color }}>{speakerMeta.label}</span>
      </button>

      {/* Collapsible body */}
      {open && (
        <div
          className="px-3 pb-3 pt-1"
          style={{ fontFamily: 'monospace', lineHeight: 1.7, color: 'var(--color-text-secondary)' }}
          data-testid="frontmatter-body"
        >
          <div><span style={{ color: 'var(--color-text-muted)' }}>speaker: </span>{doc.speaker}</div>
          <div><span style={{ color: 'var(--color-text-muted)' }}>date: </span>{doc.date}</div>
          <div>
            <span style={{ color: 'var(--color-text-muted)' }}>tags: </span>
            {doc.tags.join(', ')}
          </div>
          {doc.links.length > 0 && (
            <div>
              <span style={{ color: 'var(--color-text-muted)' }}>links: </span>
              {doc.links.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
