import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SettingsPanel from '@/components/settings/SettingsPanel'
import { useSettingsStore } from '@/stores/settingsStore'
import { useVaultStore } from '@/stores/vaultStore'
import { DEFAULT_PERSONA_MODELS } from '@/lib/modelConfig'

// ── Framer Motion mock ─────────────────────────────────────────────────────────

vi.mock('framer-motion', () => {
  const React = require('react')
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) =>
        React.forwardRef(
          (
            { children, ...props }: React.PropsWithChildren<Record<string, unknown>>,
            ref: React.Ref<unknown>
          ) => React.createElement(tag, { ...props, ref }, children)
        ),
    }
  )
  const AnimatePresence = ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children)
  return { motion, AnimatePresence }
})

// ── Helpers ────────────────────────────────────────────────────────────────────

function resetStore(panelOpen = false) {
  useSettingsStore.setState({
    personaModels: { ...DEFAULT_PERSONA_MODELS },
    settingsPanelOpen: panelOpen,
  })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('SettingsPanel', () => {
  beforeEach(() => {
    resetStore(false)
    // Reset vault store so VaultSelector renders in clean state
    useVaultStore.setState({
      vaultPath: null,
      loadedDocuments: null,
      isLoading: false,
      error: null,
    })
  })

  // ── Visibility ─────────────────────────────────────────────────────────────

  it('does not render when settingsPanelOpen is false', () => {
    resetStore(false)
    render(<SettingsPanel />)
    expect(screen.queryByTestId('settings-panel')).not.toBeInTheDocument()
  })

  it('renders when settingsPanelOpen is true', () => {
    resetStore(true)
    render(<SettingsPanel />)
    expect(screen.getByTestId('settings-panel')).toBeInTheDocument()
  })

  // ── Persona rows ───────────────────────────────────────────────────────────

  it('renders 5 persona rows', () => {
    resetStore(true)
    render(<SettingsPanel />)
    const rows = screen.getAllByTestId(/^persona-row-/)
    expect(rows).toHaveLength(5)
  })

  it('renders a model select for each persona', () => {
    resetStore(true)
    render(<SettingsPanel />)
    const selects = screen.getAllByTestId(/^model-select-/)
    expect(selects).toHaveLength(5)
  })

  it('shows default model for chief_director', () => {
    resetStore(true)
    render(<SettingsPanel />)
    const select = screen.getByTestId('model-select-chief_director') as HTMLSelectElement
    expect(select.value).toBe(DEFAULT_PERSONA_MODELS.chief_director)
  })

  it('shows default model for art_director', () => {
    resetStore(true)
    render(<SettingsPanel />)
    const select = screen.getByTestId('model-select-art_director') as HTMLSelectElement
    expect(select.value).toBe(DEFAULT_PERSONA_MODELS.art_director)
  })

  // ── Interactions ───────────────────────────────────────────────────────────

  it('changing a model select updates settingsStore', () => {
    resetStore(true)
    render(<SettingsPanel />)
    const select = screen.getByTestId('model-select-chief_director') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'gpt-4o' } })

    const { personaModels } = useSettingsStore.getState()
    expect(personaModels.chief_director).toBe('gpt-4o')
  })

  it('clicking reset button restores defaults', () => {
    useSettingsStore.setState({
      personaModels: { ...DEFAULT_PERSONA_MODELS, chief_director: 'gpt-4o' },
      settingsPanelOpen: true,
    })
    render(<SettingsPanel />)

    fireEvent.click(screen.getByTestId('settings-reset'))

    const { personaModels } = useSettingsStore.getState()
    expect(personaModels.chief_director).toBe(DEFAULT_PERSONA_MODELS.chief_director)
  })

  it('clicking close button sets settingsPanelOpen to false', () => {
    resetStore(true)
    render(<SettingsPanel />)
    fireEvent.click(screen.getByTestId('settings-close'))
    expect(useSettingsStore.getState().settingsPanelOpen).toBe(false)
  })

  it('clicking save button closes the panel', () => {
    resetStore(true)
    render(<SettingsPanel />)
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(useSettingsStore.getState().settingsPanelOpen).toBe(false)
  })

  it('clicking backdrop closes the panel', () => {
    resetStore(true)
    render(<SettingsPanel />)
    fireEvent.click(screen.getByTestId('settings-backdrop'))
    expect(useSettingsStore.getState().settingsPanelOpen).toBe(false)
  })

  // ── Content ────────────────────────────────────────────────────────────────

  it('shows all 5 speaker labels', () => {
    resetStore(true)
    render(<SettingsPanel />)
    expect(screen.getByText('Chief')).toBeInTheDocument()
    expect(screen.getByText('Art')).toBeInTheDocument()
    expect(screen.getByText('Design')).toBeInTheDocument()
    expect(screen.getByText('Level')).toBeInTheDocument()
    expect(screen.getByText('Tech')).toBeInTheDocument()
  })

  // ── VaultSelector section (in 'General' tab) ─────────────────────────────

  it('renders the vault section after switching to General tab', () => {
    resetStore(true)
    render(<SettingsPanel />)
    fireEvent.click(screen.getByText('General'))
    expect(screen.getByTestId('vault-section')).toBeInTheDocument()
  })

  it('renders the vault-selector within the General tab', () => {
    resetStore(true)
    render(<SettingsPanel />)
    fireEvent.click(screen.getByText('General'))
    expect(screen.getByTestId('vault-selector')).toBeInTheDocument()
  })

  it('renders vault-select-btn in General tab', () => {
    resetStore(true)
    render(<SettingsPanel />)
    fireEvent.click(screen.getByText('General'))
    expect(screen.getByTestId('vault-select-btn')).toBeInTheDocument()
  })
})
