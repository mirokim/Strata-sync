import { useState } from 'react'
import { useGraphStore, DEFAULT_PHYSICS } from '@/stores/graphStore'
import { Settings, RotateCcw, ChevronRight, ChevronDown, Home } from 'lucide-react'
import { graphCallbacks } from '@/lib/graphEvents'

const CLUSTER_MODES = [
  { value: 'none',   label: 'Off' },
  { value: 'tag',    label: 'Tag' },
  { value: 'folder', label: 'Folder' },
] as const

interface SliderDef {
  key: keyof typeof DEFAULT_PHYSICS
  label: string
  min: number
  max: number
  step: number
}

const SLIDERS: SliderDef[] = [
  { key: 'centerForce', label: 'Center',    min: 0,     max: 1,   step: 0.01 },
  { key: 'charge',      label: 'Repulsion', min: -1000, max: 0,   step: 10   },
  { key: 'linkStrength',label: 'Link',      min: 0,     max: 2,   step: 0.01 },
  { key: 'linkDistance',label: 'Distance',  min: 20,    max: 300, step: 5    },
  { key: 'linkOpacity', label: 'Wire',      min: 0,     max: 1,   step: 0.01 },
  { key: 'nodeRadius',  label: 'Node Size', min: 2,     max: 20,  step: 0.5  },
]

export default function PhysicsControls() {
  const { physics, updatePhysics, resetPhysics, clusterMode, setClusterMode } = useGraphStore()
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div
      style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 2,
        overflow: 'hidden',
      }}
      aria-label="Physics controls"
    >
      {/* Header / toggle button */}
      <button
        onClick={() => setIsOpen(v => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          width: '100%',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: isOpen ? 'var(--color-accent)' : 'var(--color-text-muted)',
          transition: 'color 0.15s',
        }}
        title="Toggle Physics controls"
      >
        <Settings size={11} />
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            flex: 1,
            textAlign: 'left',
          }}
        >
          Physics
        </span>
        {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
      </button>

      {/* Expanded sliders */}
      {isOpen && (
        <div
          style={{
            padding: '2px 10px 10px',
            minWidth: 200,
            borderTop: '1px solid var(--color-bg-tertiary)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginBottom: 6 }}>
            <button
              onClick={() => graphCallbacks.resetCamera?.()}
              title="Reset viewport"
              aria-label="Reset viewport"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-muted)',
                padding: 2,
                lineHeight: 1,
              }}
            >
              <Home size={11} />
            </button>
            <button
              onClick={resetPhysics}
              title="Reset Physics"
              aria-label="Reset Physics"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-muted)',
                padding: 2,
                lineHeight: 1,
              }}
            >
              <RotateCcw size={11} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SLIDERS.map(({ key, label, min, max, step }) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label
                  htmlFor={`slider-${key}`}
                  style={{
                    fontSize: 10,
                    width: 56,
                    flexShrink: 0,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  {label}
                </label>
                <input
                  id={`slider-${key}`}
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={physics[key]}
                  onChange={e => updatePhysics({ [key]: Number(e.target.value) })}
                  style={{ flex: 1 }}
                  aria-label={label}
                />
                <span
                  style={{
                    fontSize: 10,
                    width: 36,
                    textAlign: 'right',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {key === 'charge'
                    ? physics[key].toFixed(0)
                    : key === 'nodeRadius' || key === 'linkDistance'
                      ? physics[key].toFixed(1)
                      : physics[key].toFixed(2)}
                </span>
              </div>
            ))}

            {/* Cluster mode toggle — 3D only */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <span style={{ fontSize: 10, width: 56, flexShrink: 0, color: 'var(--color-text-secondary)' }}>
                Cluster
              </span>
              <div style={{ display: 'flex', gap: 3, flex: 1 }}>
                {CLUSTER_MODES.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setClusterMode(value)}
                    style={{
                      flex: 1,
                      fontSize: 10,
                      padding: '2px 0',
                      borderRadius: 3,
                      border: '1px solid',
                      cursor: 'pointer',
                      borderColor: clusterMode === value ? 'var(--color-accent)' : 'var(--color-border)',
                      background: clusterMode === value ? 'var(--color-accent)' : 'transparent',
                      color: clusterMode === value ? '#fff' : 'var(--color-text-muted)',
                      transition: 'all 0.12s',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
