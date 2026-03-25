import { useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import TopBar from './TopBar'
import ResizeHandle from './ResizeHandle'
import FileTree from '@/components/fileTree/FileTree'
import GraphPanel from '@/components/graph/GraphPanel'
import RightPanel from './RightPanel'
import SettingsPanel from '@/components/settings/SettingsPanel'
import ConverterEditor from '@/components/converter/ConverterEditor'
import MarkdownEditor from '@/components/editor/MarkdownEditor'
import ImageViewer from '@/components/editor/ImageViewer'
import ReportViewer from '@/components/editor/ReportViewer'
import PhysicsControls from '@/components/graph/PhysicsControls'
import StatusBar from './StatusBar'
import ToastContainer from '@/components/shared/ToastContainer'
import CommandPalette from '@/components/shared/CommandPalette'
import ErrorBoundary from '@/components/shared/ErrorBoundary'
import { useUIStore, RIGHT_PANEL_AGENT_MIN } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'

const LEFT_MIN = 140
const LEFT_MAX = 340
const RIGHT_MIN = 300
const RIGHT_MAX = 1000

const PANEL_SPRING = { type: 'spring', stiffness: 80, damping: 18, delay: 0.15 } as const
const OVERLAY_TRANSITION = { duration: 0.2 }
const COLLAPSE_TRANSITION = { type: 'spring', stiffness: 300, damping: 30 } as const
const NO_TRANSITION = { duration: 0 } as const

export default function MainLayout() {
  const {
    centerTab, editingDocId, leftPanelCollapsed, rightPanelCollapsed,
    editAgentPanelVisible,
    leftPanelWidth: leftWidth, rightPanelWidth: rightWidth,
    setLeftPanelWidth, setRightPanelWidth,
  } = useUIStore()
  const isFast = useSettingsStore(s => s.paragraphRenderQuality === 'fast')

  const panelTransition   = isFast ? NO_TRANSITION : PANEL_SPRING
  const overlayTransition = isFast ? NO_TRANSITION : OVERLAY_TRANSITION
  const collapseTransition = isFast ? NO_TRANSITION : COLLAPSE_TRANSITION

  const solidPanel = {
    background: 'var(--color-bg-secondary)',
    overflow: 'hidden' as const,
  }

  // Auto-expand right panel when edit agent opens, if currently too narrow
  useEffect(() => {
    if (editAgentPanelVisible) {
      const w = useUIStore.getState().rightPanelWidth
      if (w < RIGHT_PANEL_AGENT_MIN) setRightPanelWidth(RIGHT_PANEL_AGENT_MIN)
    }
  }, [editAgentPanelVisible, setRightPanelWidth])

  const handleLeftResize = useCallback((delta: number) => {
    const w = useUIStore.getState().leftPanelWidth
    setLeftPanelWidth(Math.min(LEFT_MAX, Math.max(LEFT_MIN, w + delta)))
  }, [setLeftPanelWidth])

  const handleRightResize = useCallback((delta: number) => {
    const w = useUIStore.getState().rightPanelWidth
    setRightPanelWidth(Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, w - delta)))
  }, [setRightPanelWidth])

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
      {/* Graph — fills full viewport as persistent background */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <ErrorBoundary fallback={
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: 'var(--color-text-muted)', fontSize: '0.875rem',
          }}>
            Graph rendering failed. Click to retry.
          </div>
        }>
          <GraphPanel />
        </ErrorBoundary>
      </div>

      {/* Floating UI shell — pointer-events:none so clicks fall through to graph */}
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
        {/* TopBar — flush top, full width */}
        <motion.div
          initial={isFast ? false : { y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={panelTransition}
          style={{
            flexShrink: 0,
            pointerEvents: 'auto',
            ...solidPanel,
            borderBottom: '1px solid var(--color-border)',
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
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              pointerEvents: leftPanelCollapsed ? 'none' : 'auto',
              ...solidPanel,
              borderRight: '1px solid var(--color-border)',
            }}
          >
            <FileTree />
          </motion.div>

          {/* Left resize handle */}
          {!leftPanelCollapsed && (
            <div style={{ pointerEvents: 'auto', flexShrink: 0, background: 'var(--color-bg-secondary)' }}>
              <ResizeHandle onResize={handleLeftResize} />
            </div>
          )}

          {/* Center — transparent (graph shows through) */}
          <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
            {/* Physics controls */}
            {centerTab !== 'editor' && centerTab !== 'settings' && !isFast && (
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

            {/* Editor / Settings overlay */}
            {(centerTab === 'editor' || centerTab === 'settings') && (
              <motion.div
                key={centerTab === 'settings' ? 'settings' : (editingDocId ?? 'converter')}
                initial={isFast ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={overlayTransition}
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  pointerEvents: 'auto',
                  ...solidPanel,
                }}
              >
                {centerTab === 'settings'
                  ? <SettingsPanel />
                  : editingDocId?.startsWith('gallery:')
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

          {/* Right resize handle */}
          {!rightPanelCollapsed && (
            <div style={{ pointerEvents: 'auto', flexShrink: 0, background: 'var(--color-bg-secondary)' }}>
              <ResizeHandle onResize={handleRightResize} />
            </div>
          )}

          {/* Right panel — Chat + EditAgent */}
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
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              pointerEvents: rightPanelCollapsed ? 'none' : 'auto',
              ...solidPanel,
              borderLeft: '1px solid var(--color-border)',
            }}
          >
            <RightPanel />
          </motion.div>
        </div>

        {/* StatusBar — bottom, full width */}
        <div style={{ flexShrink: 0, pointerEvents: 'auto' }}>
          <StatusBar />
        </div>
      </div>

      {/* Portals — rendered outside the pointer-events:none shell */}
      <ToastContainer />
      <CommandPalette />
    </div>
  )
}
