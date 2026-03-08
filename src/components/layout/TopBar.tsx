import { Monitor, Settings, Minus, Square, X, Terminal, PanelLeft, PanelRight, Type } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'

// ── Component ─────────────────────────────────────────────────────────────────

export default function TopBar() {
  const {
    graphMode, panelOpacity,
    leftPanelCollapsed, rightPanelCollapsed,
    setGraphMode, setPanelOpacity,
    toggleLeftPanel, toggleRightPanel,
  } = useUIStore()
  const { toggleSettingsPanel, toggleNodeLabels } = useSettingsStore()
  const isFast = useSettingsStore(s => s.paragraphRenderQuality === 'fast')
  const showNodeLabels = useSettingsStore(s => s.showNodeLabels)

  const isElectron =
    typeof window !== 'undefined' && window.electronAPI?.isElectron === true

  const dragStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

  return (
    <div
      style={{ ...dragStyle }}
      className="flex items-center justify-between px-4 h-10 shrink-0 select-none"
    >
      {/* App icon + title */}
      <div className="flex items-center gap-2" style={noDragStyle}>
        <img
          src={`${import.meta.env.BASE_URL}strata-sync-icon.svg`}
          alt="STRATA SYNC logo"
          width={20}
          height={20}
          style={{ display: 'block', flexShrink: 0 }}
          draggable={false}
        />
        <span
          className="text-xs font-semibold tracking-widest"
          style={{ color: 'var(--color-text-muted)' }}
        >
          STRATA SYNC
        </span>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-1" style={noDragStyle}>

        {/* 3D / 2D toggle — hidden in fast mode (always 2D) */}
        {!isFast && <button
          onClick={() => setGraphMode(graphMode === '3d' ? '2d' : '3d')}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
            'hover:bg-[var(--color-bg-hover)]'
          )}
          style={{ color: 'var(--color-text-secondary)' }}
          title={`Switch to ${graphMode === '3d' ? '2D' : '3D'} graph`}
          aria-label={`Switch to ${graphMode === '3d' ? '2D' : '3D'} graph`}
        >
          <Monitor size={13} />
          <span>{graphMode.toUpperCase()}</span>
        </button>}

        {/* Panel opacity slider — right of 3D toggle (hidden in fast mode) */}
        {!isFast && <div className="flex items-center gap-1.5 px-2">
          <span style={{ fontSize: 9, color: 'var(--color-text-muted)', lineHeight: 1 }}>◈</span>
          <input
            type="range"
            min={0.3}
            max={0.97}
            step={0.01}
            value={panelOpacity}
            onChange={e => {
              const val = parseFloat(e.target.value)
              setPanelOpacity(val)
              document.documentElement.style.setProperty('--panel-opacity', val.toString())
            }}
            style={{
              width: 56,
              accentColor: 'var(--color-accent)',
              cursor: 'pointer',
              outline: 'none',
            }}
            title="Panel opacity"
            aria-label="Adjust panel opacity"
          />
        </div>}

        {/* Node label toggle */}
        <button
          onClick={toggleNodeLabels}
          className={cn(
            'flex items-center justify-center w-7 h-7 rounded transition-colors',
            'hover:bg-[var(--color-bg-hover)]'
          )}
          style={{ color: showNodeLabels ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}
          title={showNodeLabels ? 'Hide node labels' : 'Show node labels'}
          aria-label="Toggle node labels"
        >
          <Type size={13} />
        </button>

        {/* Settings button */}
        <button
          onClick={toggleSettingsPanel}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
            'hover:bg-[var(--color-bg-hover)]'
          )}
          style={{ color: 'var(--color-text-secondary)' }}
          title="Settings"
          aria-label="Open settings"
          data-testid="settings-button"
        >
          <Settings size={13} />
        </button>

        {/* DevTools toggle — dev mode only */}
        {isElectron && import.meta.env.DEV && (
          <button
            onClick={() => window.windowAPI?.toggleDevTools()}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
              'hover:bg-[var(--color-bg-hover)]'
            )}
            style={{ color: 'var(--color-text-secondary)' }}
            title="Toggle DevTools"
            aria-label="Toggle developer tools"
          >
            <Terminal size={13} />
          </button>
        )}

        {/* Divider */}
        <div style={{ width: 1, height: 14, background: 'var(--color-border)', margin: '0 2px' }} />

        {/* Panel toggle buttons — VSCode style, near window controls */}
        <button
          onClick={toggleLeftPanel}
          className={cn(
            'flex items-center justify-center w-7 h-7 rounded transition-colors',
            'hover:bg-[var(--color-bg-hover)]'
          )}
          style={{ color: leftPanelCollapsed ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}
          title={leftPanelCollapsed ? 'Open left panel' : 'Close left panel'}
          aria-label="Toggle left panel"
        >
          <PanelLeft size={14} />
        </button>

        <button
          onClick={toggleRightPanel}
          className={cn(
            'flex items-center justify-center w-7 h-7 rounded transition-colors',
            'hover:bg-[var(--color-bg-hover)]'
          )}
          style={{ color: rightPanelCollapsed ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}
          title={rightPanelCollapsed ? 'Open right panel' : 'Close right panel'}
          aria-label="Toggle right panel"
        >
          <PanelRight size={14} />
        </button>

        {/* Window controls — only visible in Electron frameless mode */}
        {isElectron && (
          <div className="flex items-center ml-1">
            <button
              onClick={() => window.windowAPI?.minimize()}
              className="flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
              style={{ color: 'var(--color-text-muted)' }}
              title="Minimize"
              aria-label="Minimize window"
            >
              <Minus size={12} />
            </button>
            <button
              onClick={() => window.windowAPI?.maximize()}
              className="flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
              style={{ color: 'var(--color-text-muted)' }}
              title="Maximize / Restore"
              aria-label="Maximize or restore window"
            >
              <Square size={11} />
            </button>
            <button
              onClick={() => window.windowAPI?.close()}
              className="flex items-center justify-center w-8 h-8 rounded transition-colors hover:bg-red-500"
              style={{ color: 'var(--color-text-muted)' }}
              title="Close"
              aria-label="Close window"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
