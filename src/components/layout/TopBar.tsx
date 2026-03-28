import { Monitor, Settings, Terminal, PanelLeft, PanelRight, Type, Bot, Pencil } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useBotStore } from '@/stores/botStore'
import { useChatStore } from '@/stores/chatStore'
import { MODEL_OPTIONS } from '@/lib/modelConfig'
import { cn } from '@/lib/utils'
import VaultTabs from './VaultTabs'

// ── Connection mode badge ──────────────────────────────────────────────────

function ConnectionBadge() {
  // Currently the GUI always uses direct API calls.
  // When MCP-relay mode is added later, this will switch.
  const mode: 'api' | 'mcp' = 'api'
  const isApi = mode === 'api'

  return (
    <span
      style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.07em',
        color: isApi ? '#34d399' : '#60a5fa',
        background: isApi ? 'rgba(52,211,153,0.1)' : 'rgba(96,165,250,0.1)',
        border: `1px solid ${isApi ? 'rgba(52,211,153,0.25)' : 'rgba(96,165,250,0.25)'}`,
        borderRadius: 3, padding: '1px 5px',
        cursor: 'default',
      }}
      title={isApi ? 'API mode — direct LLM calls' : 'MCP mode — via Claude Code'}
    >
      {isApi ? 'API' : 'MCP'}
    </span>
  )
}

/** Map full model ID → compact display label (e.g. "Sonnet 4.6") */
const MODEL_SHORT: Record<string, string> = Object.fromEntries(
  MODEL_OPTIONS.map(m => {
    const short = m.label
      .replace('Claude ', '')
      .replace('GPT-', 'GPT-')
      .replace('Gemini ', 'Gemini ')
      .replace('Grok ', 'Grok ')
    return [m.id, short]
  })
)

// ── Component ─────────────────────────────────────────────────────────────────

export default function TopBar() {
  const {
    graphMode,
    leftPanelCollapsed, rightPanelCollapsed,
    setGraphMode,
    toggleLeftPanel, toggleRightPanel,
    editAgentPanelVisible, toggleEditAgentPanel,
    toggleSettingsPanel,
  } = useUIStore()
  const { toggleNodeLabels } = useSettingsStore()
  const isFast = useSettingsStore(s => s.paragraphRenderQuality === 'fast')
  const showNodeLabels = useSettingsStore(s => s.showNodeLabels)
  const slackConfigured = useSettingsStore(s => !!(s.slackBotConfig?.botToken && s.slackBotConfig?.appToken))
  const { running: botRunning, startBot, stopBot } = useBotStore()

  // Current chat model badge
  const activePersona    = useChatStore(s => s.activePersonas[0])
  const personaModels    = useSettingsStore(s => s.personaModels)
  const chatModelId      = activePersona ? (personaModels[activePersona as keyof typeof personaModels] ?? '') : ''
  const chatModelShort   = MODEL_SHORT[chatModelId] ?? chatModelId.split('-').slice(0, 2).join('-')

  const isElectron =
    typeof window !== 'undefined' && window.electronAPI?.isElectron === true

  return (
    <div
      className="flex items-center h-9 shrink-0 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: favicon + app name */}
      <div className="flex items-center gap-2" style={{ padding: '0 10px', flexShrink: 0, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <img
          src={`${import.meta.env.BASE_URL}strata-sync.svg`}
          alt=""
          width={16}
          height={16}
          style={{ display: 'block' }}
          draggable={false}
        />
        <span className="text-xs font-semibold tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
          STRATA SYNC
        </span>
        <span style={{
          fontSize: 9, fontWeight: 600, letterSpacing: '0.04em',
          color: 'var(--color-accent)', background: 'rgba(82,156,202,0.12)',
          border: '1px solid rgba(82,156,202,0.3)',
          borderRadius: 3, padding: '1px 5px',
          lineHeight: 1.4,
        }}>
          beta
        </span>
      </div>

      {/* Center: vault tabs */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'stretch' }}>
        <VaultTabs />
      </div>

      {/* Right: controls — no-drag so buttons are clickable */}
      <div className="flex items-center gap-0.5 px-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>

        {/* ── Group 1: connection + model info (read-only badges) ── */}
        <ConnectionBadge />

        {chatModelShort && (
          <span style={{
            fontSize: 10, fontWeight: 500, letterSpacing: '0.02em',
            color: 'var(--color-text-muted)',
            padding: '1px 6px',
            border: '1px solid var(--color-border)',
            borderRadius: 3,
            marginLeft: 4,
            cursor: 'default',
          }} title={`Current chat model: ${chatModelId}`}>
            {chatModelShort}
          </span>
        )}

        {/* ── Divider ── */}
        <div style={{ width: 1, height: 14, background: 'var(--color-border)', margin: '0 6px' }} />

        {/* ── Group 2: view controls ── */}

        {/* Node label toggle */}
        <button
          onClick={toggleNodeLabels}
          className={cn('flex items-center justify-center w-7 h-7 rounded transition-colors', 'hover:bg-[var(--color-bg-hover)]')}
          style={{ color: showNodeLabels ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}
          title={showNodeLabels ? 'Hide node labels' : 'Show node labels'}
          aria-label="Toggle node labels"
        >
          <Type size={13} />
        </button>

        {/* 3D / 2D toggle — hidden in fast mode */}
        {!isFast && (
          <button
            onClick={() => setGraphMode(graphMode === '3d' ? '2d' : '3d')}
            className={cn('flex items-center justify-center w-7 h-7 rounded transition-colors', 'hover:bg-[var(--color-bg-hover)]')}
            style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em' }}
            title={`${graphMode.toUpperCase()} graph — click to switch to ${graphMode === '3d' ? '2D' : '3D'}`}
            aria-label={`Switch to ${graphMode === '3d' ? '2D' : '3D'} graph`}
          >
            {graphMode === '3d' ? <Monitor size={13} /> : <Monitor size={13} style={{ opacity: 0.5 }} />}
          </button>
        )}

        {/* Settings */}
        <button
          onClick={toggleSettingsPanel}
          className={cn('flex items-center justify-center w-7 h-7 rounded transition-colors', 'hover:bg-[var(--color-bg-hover)]')}
          style={{ color: 'var(--color-text-muted)' }}
          title="Settings"
          aria-label="Open settings"
          data-testid="settings-button"
        >
          <Settings size={13} />
        </button>

        {/* DevTools — dev + Electron only */}
        {isElectron && import.meta.env.DEV && (
          <button
            onClick={() => window.windowAPI?.toggleDevTools()}
            className={cn('flex items-center justify-center w-7 h-7 rounded transition-colors', 'hover:bg-[var(--color-bg-hover)]')}
            style={{ color: 'var(--color-text-muted)' }}
            title="Developer Tools"
            aria-label="Toggle developer tools"
          >
            <Terminal size={13} />
          </button>
        )}

        {/* Slack bot — Electron only, shown when token is configured */}
        {isElectron && slackConfigured && (
          <button
            onClick={() => botRunning ? stopBot() : startBot()}
            className={cn('flex items-center gap-1 px-2 h-7 rounded transition-colors', 'hover:bg-[var(--color-bg-hover)]')}
            style={{
              border: `1px solid ${botRunning ? 'rgba(96,165,250,0.35)' : 'transparent'}`,
              background: botRunning ? 'rgba(96,165,250,0.08)' : 'transparent',
              color: botRunning ? 'var(--color-accent)' : 'var(--color-text-muted)',
            }}
            title={botRunning ? 'Stop Slack bot' : 'Start Slack bot'}
            aria-label="Toggle Slack bot"
          >
            <span style={{
              width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
              background: botRunning ? 'var(--color-accent)' : 'var(--color-text-muted)',
              boxShadow: botRunning ? '0 0 4px var(--color-accent)' : 'none',
            }} />
            <Bot size={12} />
          </button>
        )}

        {/* ── Divider ── */}
        <div style={{ width: 1, height: 14, background: 'var(--color-border)', margin: '0 4px' }} />

        {/* ── Group 3: panel layout toggles ── */}
        <button
          onClick={toggleLeftPanel}
          className={cn('flex items-center justify-center w-7 h-7 rounded transition-colors', 'hover:bg-[var(--color-bg-hover)]')}
          style={{ color: leftPanelCollapsed ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}
          title={leftPanelCollapsed ? 'Open left panel' : 'Close left panel'}
          aria-label="Toggle left panel"
        >
          <PanelLeft size={14} />
        </button>

        <button
          onClick={toggleRightPanel}
          className={cn('flex items-center justify-center w-7 h-7 rounded transition-colors', 'hover:bg-[var(--color-bg-hover)]')}
          style={{ color: rightPanelCollapsed ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}
          title={rightPanelCollapsed ? 'Open right panel' : 'Close right panel'}
          aria-label="Toggle right panel"
        >
          <PanelRight size={14} />
        </button>

        <button
          onClick={toggleEditAgentPanel}
          className={cn('flex items-center justify-center w-7 h-7 rounded transition-colors', 'hover:bg-[var(--color-bg-hover)]')}
          style={{ color: editAgentPanelVisible ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
          title={editAgentPanelVisible ? 'Close edit agent' : 'Open edit agent'}
          aria-label="Toggle edit agent panel"
        >
          <Pencil size={13} />
        </button>

      </div>

      {/* Spacer — reserves space for OS window controls (titleBarOverlay) */}
      <div style={{ width: 'calc(100vw - env(titlebar-area-width, calc(100vw - 138px)))', flexShrink: 0 }} />
    </div>
  )
}
