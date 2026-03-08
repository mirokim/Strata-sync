import { useState, useEffect, useMemo } from 'react'
import { X } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useVaultStore } from '@/stores/vaultStore'

/**
 * ImageViewer — Viewer displayed in the editor area when an image gallery node is double-clicked.
 * Rendered when editingDocId = 'gallery:{docId}'.
 *
 * One gallery node per document; displays all imageRefs from that document as a gallery.
 *
 * First attempt: strata-img:// custom protocol (direct disk load, no encoding needed)
 * Second attempt: vault:find-image-by-name IPC fallback (returns base64 data URL)
 */

/** Basename of an imageRef path, normalized (spaces→underscores, lowercase) */
function normalizeRef(ref: string): string {
  const basename = ref.split(/[/\\]/).pop() ?? ref
  return basename.toLowerCase().replace(/\s+/g, '_')
}

// ── Per-image IPC hook ─────────────────────────────────────────────────────
// Using IPC directly as the primary method (protocol approach removed — unstable in Electron dev environment)

function useImageSrc(normalizedName: string | null): {
  src: string | null
  hasError: boolean
} {
  const [src, setSrc] = useState<string | null>(null)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    setSrc(null)
    setHasError(false)
    if (!normalizedName) return

    if (window.vaultAPI?.findImageByName) {
      window.vaultAPI.findImageByName(normalizedName)
        .then((dataUrl: string | null) => {
          if (dataUrl) setSrc(dataUrl)
          else setHasError(true)
        })
        .catch(() => setHasError(true))
    } else {
      // Fallback for non-Electron environments (browser, etc.)
      setSrc(`strata-img:///${encodeURIComponent(normalizedName)}`)
    }
  }, [normalizedName])

  return { src, hasError }
}

// ── Thumbnail component ────────────────────────────────────────────────────

function Thumbnail({
  normalizedName,
  isSelected,
  onClick,
}: {
  normalizedName: string
  isSelected: boolean
  onClick: () => void
}) {
  const { src } = useImageSrc(normalizedName)
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0,
        width: 56,
        height: 56,
        borderRadius: 4,
        overflow: 'hidden',
        border: isSelected
          ? '2px solid var(--color-accent, #60a5fa)'
          : '2px solid var(--color-border)',
        background: 'var(--color-bg-surface)',
        padding: 0,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      title={normalizedName}
      aria-label={normalizedName}
      aria-pressed={isSelected}
    >
      {src && (
        <img
          src={src}
          alt={normalizedName}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </button>
  )
}

// ── Main viewer ────────────────────────────────────────────────────────────

export default function ImageViewer() {
  const { editingDocId, closeEditor } = useUIStore()
  const loadedDocuments = useVaultStore(s => s.loadedDocuments)
  const imagePathRegistry = useVaultStore(s => s.imagePathRegistry)

  // 'gallery:docId' → docId
  const docId = editingDocId?.startsWith('gallery:') ? editingDocId.slice(8) : null

  // The document that owns this gallery node
  const parentDoc = useMemo(
    () => loadedDocuments?.find(d => d.id === docId) ?? null,
    [loadedDocuments, docId],
  )

  // All normalized image refs from the parent document
  const galleryRefs = useMemo(
    () => parentDoc?.imageRefs?.map(normalizeRef) ?? [],
    [parentDoc],
  )

  // Selected image in gallery
  const [selectedRef, setSelectedRef] = useState<string | null>(null)

  // Reset selection when the gallery doc changes
  useEffect(() => { setSelectedRef(galleryRefs[0] ?? null) }, [docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeRef = selectedRef ?? galleryRefs[0] ?? null
  const { src: activeSrc, hasError: activeError } = useImageSrc(activeRef)

  // Display name for the currently active image
  const activeDisplayName = useMemo(() => {
    if (!activeRef) return 'Image'
    const origKey = Object.keys(imagePathRegistry ?? {}).find(
      k => k.toLowerCase().replace(/\s+/g, '_') === activeRef
    )
    return origKey ?? activeRef
  }, [activeRef, imagePathRegistry])

  const isGallery = galleryRefs.length > 1
  const galleryIndex = activeRef ? galleryRefs.indexOf(activeRef) : 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="shrink-0 flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <span
          className="text-xs font-mono truncate"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          🖼️ {isGallery
            ? `${activeDisplayName} (${galleryIndex + 1}/${galleryRefs.length})`
            : activeDisplayName}
        </span>
        <button
          onClick={closeEditor}
          className="p-1 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
          style={{ color: 'var(--color-text-muted)' }}
          aria-label="Close image viewer"
        >
          <X size={14} />
        </button>
      </div>

      {/* Main image area */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-auto">
        {activeSrc && !activeError ? (
          <img
            key={activeRef}
            src={activeSrc}
            alt={activeDisplayName}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 6,
            }}
          />
        ) : (
          <div className="text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>
            <div>Unable to load image</div>
            <div className="text-xs mt-1 font-mono opacity-60">{activeDisplayName}</div>
          </div>
        )}
      </div>

      {/* Gallery thumbnail row */}
      {isGallery && (
        <div
          className="shrink-0 px-4 py-2"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            {galleryRefs.map(ref => (
              <Thumbnail
                key={ref}
                normalizedName={ref}
                isSelected={ref === activeRef}
                onClick={() => setSelectedRef(ref)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
