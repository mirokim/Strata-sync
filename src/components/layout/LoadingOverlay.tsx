import { useEffect, useRef, useState, useCallback } from 'react'
import { useVaultStore } from '@/stores/vaultStore'
import { useGraphStore } from '@/stores/graphStore'
import { useSettingsStore, type ParagraphRenderQuality } from '@/stores/settingsStore'

// Satellite positions: 6 dots in a hexagon
const SATELLITES = [0, 60, 120, 180, 240, 300].map((deg, i) => {
  const rad = (deg * Math.PI) / 180
  return { x: Math.round(Math.cos(rad) * 22), y: Math.round(Math.sin(rad) * 22), delay: i * 0.28 }
})

const QUALITY_OPTIONS: { value: ParagraphRenderQuality; label: string; desc: string }[] = [
  { value: 'high',   label: 'High',   desc: 'Markdown + WikiLink rendering' },
  { value: 'medium', label: 'Medium', desc: 'Markdown rendering only' },
  { value: 'fast',   label: 'Fast',   desc: 'Plain text (fastest)' },
]

// Conditions for showing the performance selector
// - 100+ files (scale where quality mode makes a noticeable speed difference)
// - or 50+ files in high mode (high is especially heavy)
function shouldShowPerfSelector(fileCount: number | null, quality: ParagraphRenderQuality): boolean {
  if (fileCount === null) return false
  if (fileCount >= 100) return true
  if (quality === 'high' && fileCount >= 50) return true
  return false
}

export default function LoadingOverlay() {
  const { isLoading, vaultPath, vaultReady, loadingProgress, loadingPhase, pendingFileCount } = useVaultStore()
  const graphLayoutReady = useGraphStore(s => s.graphLayoutReady)
  const { paragraphRenderQuality, setParagraphRenderQuality } = useSettingsStore()

  // Stay visible until: vault parsed + graph simulation settled + fit-to-view applied
  const shouldShow = isLoading
    || (vaultPath !== null && !vaultReady)
    || (vaultReady && vaultPath !== null && !graphLayoutReady)

  // Keep overlay visible until user clicks "Start" if the quality selector was shown
  const [awaitingChoice, setAwaitingChoice] = useState(false)
  const selectorShownRef = useRef(false)
  // pendingFileCount becomes null after loading completes, so remember the value at the time the selector was shown
  const frozenFileCountRef = useRef<number | null>(null)

  // Record the flag and file count the first time the selector becomes visible
  if (shouldShowPerfSelector(pendingFileCount, paragraphRenderQuality)) {
    selectorShownRef.current = true
    if (pendingFileCount !== null) frozenFileCountRef.current = pendingFileCount
  }

  // Set awaitingChoice = true if the selector was shown when loading completed
  useEffect(() => {
    if (!shouldShow && selectorShownRef.current) {
      setAwaitingChoice(true)
    }
  }, [shouldShow])

  const handleStart = useCallback(() => {
    selectorShownRef.current = false
    frozenFileCountRef.current = null
    setAwaitingChoice(false)
  }, [])

  // Actual overlay display condition: loading OR awaiting user selection
  const effectiveShouldShow = shouldShow || awaitingChoice
  // Show selector condition: condition met during loading, or awaiting user response
  const showSelector = awaitingChoice || shouldShowPerfSelector(pendingFileCount, paragraphRenderQuality)
  const displayFileCount = frozenFileCountRef.current ?? pendingFileCount

  const [visible, setVisible] = useState(effectiveShouldShow)
  const [fading, setFading] = useState(false)
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (effectiveShouldShow) {
      if (fadeTimer.current) clearTimeout(fadeTimer.current)
      setFading(false)
      setVisible(true)
    } else if (visible) {
      setFading(true)
      fadeTimer.current = setTimeout(() => {
        setVisible(false)
        setFading(false)
      }, 700)
    }
    return () => { if (fadeTimer.current) clearTimeout(fadeTimer.current) }
  }, [effectiveShouldShow, visible])

  if (!visible) return null

  const displayPhase = loadingPhase || 'Loading vault...'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg-primary)',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.7s ease',
        pointerEvents: fading ? 'none' : 'auto',
      }}
    >
      {/* ── Graph-dot animation ── */}
      <div style={{ marginBottom: 32 }}>
        <svg width="64" height="64" viewBox="-32 -32 64 64" overflow="visible">
          {/* Lines from center to each satellite */}
          {SATELLITES.map((s, i) => (
            <line
              key={`line-${i}`}
              x1="0" y1="0"
              x2={s.x} y2={s.y}
              stroke="var(--color-text-secondary)"
              strokeWidth="1"
            >
              <animate
                attributeName="opacity"
                values="0;0.35;0.35;0"
                dur="1.7s"
                begin={`${s.delay}s`}
                repeatCount="indefinite"
              />
            </line>
          ))}

          {/* Satellite dots — appear and fade with staggered delay */}
          {SATELLITES.map((s, i) => (
            <circle
              key={`sat-${i}`}
              cx={s.x} cy={s.y}
              r="0"
              fill="var(--color-text-muted)"
            >
              <animate
                attributeName="r"
                values="0;3;3;0"
                dur="1.7s"
                begin={`${s.delay}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0;0.9;0.9;0"
                dur="1.7s"
                begin={`${s.delay}s`}
                repeatCount="indefinite"
              />
            </circle>
          ))}

          {/* Center dot — continuous pulse */}
          <circle cx="0" cy="0" fill="var(--color-accent, #60a5fa)" r="6">
            <animate attributeName="r"       values="5;7.5;5"     dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0.45;0.9" dur="1.5s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>

      {/* ── Info block ── */}
      <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            color: 'var(--color-text-primary)',
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: '0.04em',
            opacity: 0.85,
          }}
        >
          STRATA SYNC
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              background: 'var(--color-accent, #60a5fa)',
              width: `${loadingProgress}%`,
              borderRadius: 2,
              transition: 'width 0.25s ease',
            }}
          />
        </div>

        {/* Phase label + percentage */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            color: 'var(--color-text-secondary)',
            fontSize: 12,
            opacity: 0.65,
          }}
        >
          <span>{displayPhase}</span>
          {loadingProgress > 0 && <span>{loadingProgress}%</span>}
        </div>

        {/* Performance selector — shown when file count is high, retained while awaiting choice */}
        {showSelector && (
          <div
            style={{
              marginTop: 8,
              padding: '10px 12px',
              background: 'var(--color-bg-overlay)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: 'var(--color-text-muted)',
                marginBottom: 8,
                letterSpacing: '0.05em',
              }}
            >
              {displayFileCount} files detected — select rendering quality
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {QUALITY_OPTIONS.map(({ value, label, desc }) => {
                const isActive = paragraphRenderQuality === value
                return (
                  <button
                    key={value}
                    onClick={() => setParagraphRenderQuality(value)}
                    title={desc}
                    style={{
                      flex: 1,
                      padding: '5px 4px',
                      borderRadius: 5,
                      border: isActive
                        ? '1px solid var(--color-accent, #60a5fa)'
                        : '1px solid var(--color-border)',
                      background: isActive
                        ? 'rgba(96,165,250,0.12)'
                        : 'var(--color-bg-surface)',
                      color: isActive
                        ? 'var(--color-accent, #60a5fa)'
                        : 'var(--color-text-secondary)',
                      fontSize: 11,
                      fontWeight: isActive ? 600 : 400,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {/* Button to confirm quality selection and start after loading completes */}
            {awaitingChoice && (
              <button
                onClick={handleStart}
                style={{
                  marginTop: 8,
                  width: '100%',
                  padding: '6px 0',
                  borderRadius: 5,
                  border: '1px solid var(--color-accent, #60a5fa)',
                  background: 'rgba(96,165,250,0.15)',
                  color: 'var(--color-accent, #60a5fa)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  letterSpacing: '0.04em',
                  transition: 'all 0.15s',
                }}
              >
                Start
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
