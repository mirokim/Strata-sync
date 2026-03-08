import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppState, CenterTab, ThemeId, GraphMode, NodeColorMode } from '@/types'

interface UIState {
  appState: AppState
  centerTab: CenterTab
  selectedDocId: string | null
  theme: ThemeId
  graphMode: GraphMode
  panelOpacity: number
  nodeColorMode: NodeColorMode
  /** ID of the document currently open in the markdown editor (null = converter editor) */
  editingDocId: string | null
  /** Whether the left (file tree) panel is collapsed */
  leftPanelCollapsed: boolean
  /** Whether the right (chat) panel is collapsed */
  rightPanelCollapsed: boolean
  setAppState: (s: AppState) => void
  setCenterTab: (t: CenterTab) => void
  setSelectedDoc: (id: string | null) => void
  setTheme: (t: ThemeId) => void
  setGraphMode: (m: GraphMode) => void
  setPanelOpacity: (o: number) => void
  setNodeColorMode: (m: NodeColorMode) => void
  /** Open a vault document in the markdown editor */
  openInEditor: (docId: string) => void
  /** Close the editor (back to converter or graph) */
  closeEditor: () => void
  toggleLeftPanel: () => void
  toggleRightPanel: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      appState: 'launch',
      centerTab: 'graph',
      selectedDocId: null,
      theme: 'dark',
      graphMode: '3d',
      panelOpacity: 0.3,
      nodeColorMode: 'document',
      editingDocId: null,
      leftPanelCollapsed: false,
      rightPanelCollapsed: false,

      setAppState: (appState) => set({ appState }),
      setCenterTab: (centerTab) => set({ centerTab }),
      setSelectedDoc: (selectedDocId) => set({ selectedDocId }),
      setTheme: (theme) => set({ theme }),
      setGraphMode: (graphMode) => set({ graphMode }),
      setPanelOpacity: (panelOpacity) => set({ panelOpacity }),
      setNodeColorMode: (nodeColorMode) => set({ nodeColorMode }),
      openInEditor: (docId) => set({ editingDocId: docId, centerTab: 'editor' }),
      closeEditor: () => set({ editingDocId: null, centerTab: 'graph' }),
      toggleLeftPanel: () => set(s => ({ leftPanelCollapsed: !s.leftPanelCollapsed })),
      toggleRightPanel: () => set(s => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
    }),
    {
      name: 'strata-sync-ui',
      version: 2,
      migrate: (persisted: any, version: number) => {
        // v0/v1: 'speaker' was the default — migrate to 'document' mode
        if (version < 2 && (persisted.nodeColorMode === 'speaker' || !persisted.nodeColorMode)) {
          persisted.nodeColorMode = 'document'
        }
        return persisted
      },
      partialize: (state) => ({
        theme: state.theme,
        nodeColorMode: state.nodeColorMode,
        // graphMode is NOT persisted — app always starts in 3D (user intent)
        panelOpacity: state.panelOpacity,
      }),
    }
  )
)
