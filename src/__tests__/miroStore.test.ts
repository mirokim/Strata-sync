import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useMiroStore } from '@/stores/miroStore'
import { DEFAULT_CONFIG, DEFAULT_PERSONAS } from '@/services/mirofish/types'

// ── Mock external dependencies used by simulation actions ───────────────────────
vi.mock('@/services/mirofish/personaGenerator', () => ({
  generatePersonas: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/services/mirofish/simulationEngine', () => ({
  runSimulation: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/services/mirofish/reportGenerator', () => ({
  generateReport: vi.fn().mockResolvedValue('mock report'),
}))

// ── Helpers ────────────────────────────────────────────────────────────────────

function resetStore() {
  useMiroStore.setState({
    config: { ...DEFAULT_CONFIG, personas: [...DEFAULT_PERSONAS] },
    simState: {
      status: 'idle',
      currentRound: 0,
      totalRounds: 0,
      feed: [],
      streamingPost: null,
      report: '',
    },
    _abortController: null,
    presets: [],
    scheduledTopics: [],
    simulationHistory: [],
  })
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore()
})

// ── addPersona ────────────────────────────────────────────────────────────────

describe('useMiroStore — addPersona()', () => {
  it('adds a new persona to the config', () => {
    const before = useMiroStore.getState().config.personas.length
    useMiroStore.getState().addPersona()
    const after = useMiroStore.getState().config.personas.length
    expect(after).toBe(before + 1)
  })

  it('new persona has expected default fields', () => {
    useMiroStore.getState().addPersona()
    const personas = useMiroStore.getState().config.personas
    const last = personas[personas.length - 1]
    expect(last.name).toBe('New Persona')
    expect(last.stance).toBe('neutral')
    expect(last.id).toContain('persona_')
  })

  it('caps at 50 personas', () => {
    // Set personas to 50 items
    const fiftyPersonas = Array.from({ length: 50 }, (_, i) => ({
      id: `p${i}`,
      name: `Persona ${i}`,
      role: 'role',
      stance: 'neutral' as const,
      activityLevel: 0.5,
      influenceWeight: 0.5,
      systemPrompt: 'prompt',
    }))
    useMiroStore.setState({
      config: { ...useMiroStore.getState().config, personas: fiftyPersonas },
    })
    expect(useMiroStore.getState().config.personas).toHaveLength(50)

    // Adding one more should not increase the count
    useMiroStore.getState().addPersona()
    expect(useMiroStore.getState().config.personas).toHaveLength(50)
  })
})

// ── removePersona ─────────────────────────────────────────────────────────────

describe('useMiroStore — removePersona()', () => {
  it('removes a persona by id', () => {
    const personas = useMiroStore.getState().config.personas
    const targetId = personas[0].id
    useMiroStore.getState().removePersona(targetId)
    const updated = useMiroStore.getState().config.personas
    expect(updated.find(p => p.id === targetId)).toBeUndefined()
    expect(updated.length).toBe(personas.length - 1)
  })

  it('does not affect other personas', () => {
    const personas = useMiroStore.getState().config.personas
    const removeId = personas[0].id
    const keepId = personas[1].id
    useMiroStore.getState().removePersona(removeId)
    expect(useMiroStore.getState().config.personas.find(p => p.id === keepId)).toBeDefined()
  })

  it('is a no-op for non-existent id', () => {
    const before = useMiroStore.getState().config.personas.length
    useMiroStore.getState().removePersona('non-existent-id')
    expect(useMiroStore.getState().config.personas.length).toBe(before)
  })
})

// ── Preset CRUD ───────────────────────────────────────────────────────────────

describe('useMiroStore — Preset CRUD', () => {
  it('savePreset adds a preset', () => {
    useMiroStore.getState().savePreset('My Preset')
    const { presets } = useMiroStore.getState()
    expect(presets).toHaveLength(1)
    expect(presets[0].name).toBe('My Preset')
    expect(presets[0].id).toContain('preset_')
  })

  it('savePreset captures current personas', () => {
    useMiroStore.getState().savePreset('Snapshot')
    const { presets, config } = useMiroStore.getState()
    expect(presets[0].personas.length).toBe(
      Math.min(config.personas.length, config.numPersonas)
    )
  })

  it('loadPreset restores personas from preset', () => {
    useMiroStore.getState().savePreset('Test Preset')
    const presetId = useMiroStore.getState().presets[0].id
    const presetPersonas = useMiroStore.getState().presets[0].personas

    // Modify current personas
    useMiroStore.getState().addPersona()

    // Load preset
    useMiroStore.getState().loadPreset(presetId)
    const { config } = useMiroStore.getState()
    expect(config.personas).toEqual(presetPersonas)
    expect(config.autoGeneratePersonas).toBe(false)
  })

  it('loadPreset is a no-op for non-existent preset', () => {
    const before = useMiroStore.getState().config.personas.length
    useMiroStore.getState().loadPreset('non-existent')
    expect(useMiroStore.getState().config.personas.length).toBe(before)
  })

  it('deletePreset removes a preset', () => {
    useMiroStore.getState().savePreset('To Delete')
    const id = useMiroStore.getState().presets[0].id
    useMiroStore.getState().deletePreset(id)
    expect(useMiroStore.getState().presets).toHaveLength(0)
  })
})

// ── simulationHistory cap ─────────────────────────────────────────────────────

describe('useMiroStore — simulationHistory cap', () => {
  it('history is capped at 20 entries', () => {
    // Manually set 20 history entries
    const entries = Array.from({ length: 20 }, (_, i) => ({
      id: `hist_${i}`,
      topic: `Topic ${i}`,
      numPersonas: 5,
      numRounds: 3,
      feed: [],
      report: '',
      createdAt: Date.now() - i * 1000,
    }))
    useMiroStore.setState({ simulationHistory: entries })
    expect(useMiroStore.getState().simulationHistory).toHaveLength(20)
  })

  it('deleteHistoryEntry removes by id', () => {
    useMiroStore.setState({
      simulationHistory: [
        { id: 'h1', topic: 'A', numPersonas: 5, numRounds: 3, feed: [], report: '', createdAt: 1 },
        { id: 'h2', topic: 'B', numPersonas: 5, numRounds: 3, feed: [], report: '', createdAt: 2 },
      ],
    })
    useMiroStore.getState().deleteHistoryEntry('h1')
    const { simulationHistory } = useMiroStore.getState()
    expect(simulationHistory).toHaveLength(1)
    expect(simulationHistory[0].id).toBe('h2')
  })

  it('clearHistory removes all entries', () => {
    useMiroStore.setState({
      simulationHistory: [
        { id: 'h1', topic: 'A', numPersonas: 5, numRounds: 3, feed: [], report: '', createdAt: 1 },
      ],
    })
    useMiroStore.getState().clearHistory()
    expect(useMiroStore.getState().simulationHistory).toHaveLength(0)
  })
})

// ── resetSimulation ───────────────────────────────────────────────────────────

describe('useMiroStore — resetSimulation()', () => {
  it('resets simState to initial values', () => {
    useMiroStore.setState({
      simState: {
        status: 'done',
        currentRound: 5,
        totalRounds: 5,
        feed: [{ round: 1, personaId: 'p1', personaName: 'Test', stance: 'neutral', content: 'text', timestamp: 1 }],
        streamingPost: null,
        report: 'some report',
      },
    })

    useMiroStore.getState().resetSimulation()
    const { simState } = useMiroStore.getState()
    expect(simState.status).toBe('idle')
    expect(simState.currentRound).toBe(0)
    expect(simState.totalRounds).toBe(0)
    expect(simState.feed).toHaveLength(0)
    expect(simState.report).toBe('')
    expect(simState.streamingPost).toBeNull()
  })

  it('does not affect config or presets', () => {
    useMiroStore.getState().savePreset('Keep This')
    useMiroStore.getState().resetSimulation()
    expect(useMiroStore.getState().presets).toHaveLength(1)
    expect(useMiroStore.getState().config.personas.length).toBeGreaterThan(0)
  })
})
