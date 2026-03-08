import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import TopBar from './TopBar'
import ResizeHandle from './ResizeHandle'
import FileTree from '@/components/fileTree/FileTree'
import GraphPanel from '@/components/graph/GraphPanel'
import ChatPanel from '@/components/chat/ChatPanel'
import SettingsPanel from '@/components/settings/SettingsPanel'
import ConverterEditor from '@/components/converter/ConverterEditor'
import MarkdownEditor from '@/components/editor/MarkdownEditor'
import ImageViewer from '@/components/editor/ImageViewer'
import ReportViewer from '@/components/editor/ReportViewer'
import PhysicsControls from '@/components/graph/PhysicsControls'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'

const LEFT_MIN = 140
const LEFT_MAX = 340
const RIGHT_MIN = 300
const RIGHT_MAX = 600

const PANEL_SPRING = { type: 'spring', stiffness: 80, damping: 18, delay: 0.15 } as const
const OVERLAY_TRANSITION = { duration: 0.2 }
const COLLAPSE_TRANSITION = { type: 'spring', stiffness: 300, damping: 30 } as const
const NO_TRANSITION = { duration: 0 } as const

export default function MainLayout() {
  const { centerTab, editingDocId, leftPanelCollapsed, rightPanelCollapsed } = useUIStore()
  const isFast = useSettingsStore(s => s.paragraphRenderQuality === 'fast')

  const panelTransition   = isFast ? NO_TRANSITION : PANEL_SPRING
  const overlayTransition = isFast ? NO_TRANSITION : OVERLAY_TRANSITION
  const collapseTransition = isFast ? NO_TRANSITION : COLLAPSE_TRANSITION

  // In fast mode: solid background (no blur compositing). Normal mode: frosted glass.
  const glassPanelStyle = isFast
    ? {
        background: 'var(--color-bg-secondary)',
        borderRadius: 10,
        overflow: 'hidden' as const,
        border: '1px solid var(--color-border)',
      }
    : {
        background: 'var(--color-bg-overlay)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderRadius: 10,
        overflow: 'hidden' as const,
        border: '1px solid rgba(255,255,255,0.04)',
      }
  const [leftWidth, setLeftWidth] = useState(250)
  const [rightWidth, setRightWidth] = useState(500)

  const handleLeftResize = useCallback((delta: number) => {
    setLeftWidth(w => Math.min(LEFT_MAX, Math.max(LEFT_MIN, w + delta)))
  }, [])

  const handleRightResize = useCallback((delta: number) => {
    setRightWidth(w => Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, w - delta)))
  }, [])

  return (
    <div
      data-perf={isFast ? 'fast' : undefined}
      style={{
        height: '100vh',
        background: 'var(--color-bg-primary)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* ── Graph — fills full viewport as persistent background ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <GraphPanel />
      </div>

      {/* ── Floating UI shell — pointer-events:none so clicks fall through to graph ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'none',
        }}
      >
        {/* TopBar float */}
        <motion.div
          initial={isFast ? false : { y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={panelTransition}
          style={{
            margin: '12px 12px 0',
            flexShrink: 0,
            pointerEvents: 'auto',
            ...glassPanelStyle,
          }}
        >
          <TopBar />
        </motion.div>

        {/* Main content row */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

          {/* Left panel — File tree */}
          <motion.div
            initial={isFast ? false : { x: -leftWidth, opacity: 0 }}
            animate={{
              x: 0,
              opacity: leftPanelCollapsed ? 0 : 1,
              width: leftPanelCollapsed ? 0 : leftWidth,
            }}
            transition={leftPanelCollapsed ? collapseTransition : panelTransition}
            style={{
              minWidth: leftPanelCollapsed ? 0 : leftWidth,
              margin: leftPanelCollapsed ? '0' : '8px 0 12px 12px',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              pointerEvents: leftPanelCollapsed ? 'none' : 'auto',
              ...glassPanelStyle,
            }}
          >
            <FileTree />
          </motion.div>

          {/* Left resize handle — hidden when collapsed */}
          {!leftPanelCollapsed && (
            <div style={{ pointerEvents: 'auto', flexShrink: 0 }}>
              <ResizeHandle onResize={handleLeftResize} />
            </div>
          )}

          {/* Center — transparent spacer (graph shows through); overlays float here */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              position: 'relative',
              margin: '8px 0 12px 0',
            }}
          >
            {/* Physics controls — hidden in fast mode (physics is disabled) */}
            {centerTab !== 'editor' && !isFast && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 12,
                  right: 12,
                  zIndex: 5,
                  pointerEvents: 'auto',
                }}
              >
                <PhysicsControls />
              </div>
            )}

            {/* Editor overlay: Markdown editor (from file tree) or Converter (from toolbar) */}
            {centerTab === 'editor' && (
              <motion.div
                key={editingDocId ?? 'converter'}
                initial={isFast ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={overlayTransition}
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  pointerEvents: 'auto',
                  ...glassPanelStyle,
                }}
              >
                {editingDocId?.startsWith('gallery:')
                  ? <ImageViewer />
                  : editingDocId?.startsWith('report:')
                    ? <ReportViewer />
                    : editingDocId
                      ? <MarkdownEditor />
                      : <ConverterEditor />
                }
              </motion.div>
            )}
          </div>

          {/* Right resize handle — hidden when collapsed */}
          {!rightPanelCollapsed && (
            <div style={{ pointerEvents: 'auto', flexShrink: 0 }}>
              <ResizeHandle onResize={handleRightResize} />
            </div>
          )}

          {/* Right panel — Chat */}
          <motion.div
            initial={isFast ? false : { x: rightWidth, opacity: 0 }}
            animate={{
              x: 0,
              opacity: rightPanelCollapsed ? 0 : 1,
              width: rightPanelCollapsed ? 0 : rightWidth,
            }}
            transition={rightPanelCollapsed ? collapseTransition : panelTransition}
            style={{
              minWidth: rightPanelCollapsed ? 0 : rightWidth,
              margin: rightPanelCollapsed ? '0' : '8px 12px 12px 0',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              pointerEvents: rightPanelCollapsed ? 'none' : 'auto',
              ...glassPanelStyle,
            }}
          >
            <ChatPanel />
          </motion.div>
        </div>
      </div>

      {/* Settings panel overlay (manages its own z-index) */}
      <SettingsPanel />
    </div>
  )
}
