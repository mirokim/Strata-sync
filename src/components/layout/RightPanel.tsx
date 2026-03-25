/**
 * RightPanel — contains ChatPanel + optional EditAgentPanel.
 * When window width < OVERLAY_BREAKPOINT and edit agent is open,
 * the agent panel renders as a fixed slide-over drawer instead of inline.
 */
import { useState, useCallback, useEffect } from 'react'
import ChatPanel from '@/components/chat/ChatPanel'
import EditAgentPanel from '@/components/editAgent/EditAgentPanel'
import ResizeHandle from './ResizeHandle'
import { useUIStore } from '@/stores/uiStore'

const AGENT_MIN = 240
const AGENT_MAX = 700
/** Screen width threshold below which the agent panel switches to overlay mode */
const OVERLAY_BREAKPOINT = 1200

export default function RightPanel() {
  const editAgentPanelVisible = useUIStore(s => s.editAgentPanelVisible)
  const agentWidth            = useUIStore(s => s.agentPanelWidth)
  const setAgentPanelWidth    = useUIStore(s => s.setAgentPanelWidth)
  const toggleEditAgentPanel  = useUIStore(s => s.toggleEditAgentPanel)

  const [windowWidth, setWindowWidth] = useState(window.innerWidth)

  // Track window width for overlay mode
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const handleAgentResize = useCallback((delta: number) => {
    const w = useUIStore.getState().agentPanelWidth
    setAgentPanelWidth(Math.min(AGENT_MAX, Math.max(AGENT_MIN, w - delta)))
  }, [setAgentPanelWidth])

  const isOverlay = windowWidth < OVERLAY_BREAKPOINT

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', position: 'relative' }}>
      {/* Chat panel — fills remaining width */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <ChatPanel />
      </div>

      {/* Edit Agent panel */}
      {editAgentPanelVisible && (
        isOverlay ? (
          /* Overlay / slide-over mode (narrow screen) */
          <>
            {/* Backdrop */}
            <div
              onClick={toggleEditAgentPanel}
              style={{
                position: 'fixed', inset: 0, zIndex: 49,
                background: 'rgba(0,0,0,0.4)',
                backdropFilter: 'blur(2px)',
              }}
            />
            {/* Drawer */}
            <div style={{
              position: 'fixed',
              top: 36, bottom: 26, right: 0,
              width: Math.min(agentWidth, windowWidth * 0.85),
              zIndex: 50,
              boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
              overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
            }}>
              <EditAgentPanel />
            </div>
          </>
        ) : (
          /* Inline mode (wide screen) */
          <>
            <div style={{ flexShrink: 0, background: 'var(--color-bg-secondary)' }}>
              <ResizeHandle onResize={handleAgentResize} />
            </div>
            <div style={{ width: agentWidth, flexShrink: 0, overflow: 'hidden' }}>
              <EditAgentPanel />
            </div>
          </>
        )
      )}
    </div>
  )
}
