import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSettingsStore, DEFAULT_SEARCH_CONFIG, getApiKey } from '@/stores/settingsStore'
import { DEFAULT_PERSONA_MODELS } from '@/lib/modelConfig'
import type { SpeakerId } from '@/types'

const SPEAKER_IDS: SpeakerId[] = [
  'chief_director',
  'art_director',
  'plan_director',
  'level_director',
  'prog_director',
]

function resetStore() {
  useSettingsStore.setState({
    personaModels: { ...DEFAULT_PERSONA_MODELS },
    apiKeys: {},
    searchConfig: { ...DEFAULT_SEARCH_CONFIG },
  })
}

describe('settingsStore', () => {
  beforeEach(() => {
    resetStore()
  })

  // ── Default state ──────────────────────────────────────────────────────────

  it('has default persona models for all 5 speakers', () => {
    const { personaModels } = useSettingsStore.getState()
    for (const id of SPEAKER_IDS) {
      expect(personaModels[id]).toBeTruthy()
    }
  })

  it('default chief_director model is a Claude model', () => {
    const { personaModels } = useSettingsStore.getState()
    expect(personaModels.chief_director).toContain('claude')
  })

  it('default art_director model is gpt-4.1', () => {
    const { personaModels } = useSettingsStore.getState()
    expect(personaModels.art_director).toBe('gpt-4.1')
  })

  it('default plan_director model is a Gemini model', () => {
    const { personaModels } = useSettingsStore.getState()
    expect(personaModels.plan_director).toContain('gemini')
  })

  // ── setPersonaModel ────────────────────────────────────────────────────────

  it('setPersonaModel updates a single persona without affecting others', () => {
    const { setPersonaModel } = useSettingsStore.getState()
    setPersonaModel('chief_director', 'gpt-4o')

    const { personaModels } = useSettingsStore.getState()
    expect(personaModels.chief_director).toBe('gpt-4o')
    // Others unchanged
    expect(personaModels.art_director).toBe(DEFAULT_PERSONA_MODELS.art_director)
    expect(personaModels.plan_director).toBe(DEFAULT_PERSONA_MODELS.plan_director)
  })

  it('setPersonaModel can be called multiple times independently', () => {
    const { setPersonaModel } = useSettingsStore.getState()
    setPersonaModel('chief_director', 'gpt-4o')
    setPersonaModel('prog_director', 'gemini-2.5-flash')

    const { personaModels } = useSettingsStore.getState()
    expect(personaModels.chief_director).toBe('gpt-4o')
    expect(personaModels.prog_director).toBe('gemini-2.5-flash')
  })

  // ── resetPersonaModels ─────────────────────────────────────────────────────

  it('resetPersonaModels restores all defaults', () => {
    const { setPersonaModel, resetPersonaModels } = useSettingsStore.getState()
    setPersonaModel('chief_director', 'gpt-4o')
    setPersonaModel('art_director', 'gemini-2.5-pro')

    resetPersonaModels()

    const { personaModels } = useSettingsStore.getState()
    expect(personaModels.chief_director).toBe(DEFAULT_PERSONA_MODELS.chief_director)
    expect(personaModels.art_director).toBe(DEFAULT_PERSONA_MODELS.art_director)
  })
})

describe('settingsStore — paragraphRenderQuality', () => {
  it('defaults to "high"', () => {
    expect(useSettingsStore.getState().paragraphRenderQuality).toBe('high')
  })

  it('setParagraphRenderQuality changes to "high"', () => {
    useSettingsStore.getState().setParagraphRenderQuality('high')
    expect(useSettingsStore.getState().paragraphRenderQuality).toBe('high')
  })

  it('setParagraphRenderQuality changes to "medium"', () => {
    useSettingsStore.getState().setParagraphRenderQuality('medium')
    expect(useSettingsStore.getState().paragraphRenderQuality).toBe('medium')
  })

  it('cycles through all three quality levels', () => {
    const { setParagraphRenderQuality } = useSettingsStore.getState()
    setParagraphRenderQuality('high')
    expect(useSettingsStore.getState().paragraphRenderQuality).toBe('high')
    setParagraphRenderQuality('medium')
    expect(useSettingsStore.getState().paragraphRenderQuality).toBe('medium')
    setParagraphRenderQuality('fast')
    expect(useSettingsStore.getState().paragraphRenderQuality).toBe('fast')
  })
})

describe('settingsStore — showNodeLabels / toggleNodeLabels', () => {
  beforeEach(() => {
    useSettingsStore.setState({ showNodeLabels: false })
  })

  it('defaults to false', () => {
    expect(useSettingsStore.getState().showNodeLabels).toBe(false)
  })

  it('toggleNodeLabels flips to true', () => {
    useSettingsStore.getState().toggleNodeLabels()
    expect(useSettingsStore.getState().showNodeLabels).toBe(true)
  })

  it('toggleNodeLabels flips back to false', () => {
    useSettingsStore.getState().toggleNodeLabels()
    useSettingsStore.getState().toggleNodeLabels()
    expect(useSettingsStore.getState().showNodeLabels).toBe(false)
  })

  it('toggling does not affect paragraphRenderQuality', () => {
    useSettingsStore.getState().setParagraphRenderQuality('high')
    useSettingsStore.getState().toggleNodeLabels()
    expect(useSettingsStore.getState().paragraphRenderQuality).toBe('high')
    expect(useSettingsStore.getState().showNodeLabels).toBe(true)
  })
})

// ── setSearchConfig ───────────────────────────────────────────────────────────

describe('settingsStore — setSearchConfig()', () => {
  beforeEach(() => {
    useSettingsStore.setState({ searchConfig: { ...DEFAULT_SEARCH_CONFIG } })
  })

  it('merges partial config, preserves other fields', () => {
    useSettingsStore.getState().setSearchConfig({ filenameWeight: 20 })
    const { searchConfig } = useSettingsStore.getState()
    expect(searchConfig.filenameWeight).toBe(20)
    // Other fields preserved
    expect(searchConfig.bodyWeight).toBe(DEFAULT_SEARCH_CONFIG.bodyWeight)
    expect(searchConfig.bm25Candidates).toBe(DEFAULT_SEARCH_CONFIG.bm25Candidates)
    expect(searchConfig.bfsMaxHops).toBe(DEFAULT_SEARCH_CONFIG.bfsMaxHops)
  })

  it('can update multiple fields at once', () => {
    useSettingsStore.getState().setSearchConfig({
      filenameWeight: 5,
      bodyWeight: 3,
      bfsMaxHops: 5,
    })
    const { searchConfig } = useSettingsStore.getState()
    expect(searchConfig.filenameWeight).toBe(5)
    expect(searchConfig.bodyWeight).toBe(3)
    expect(searchConfig.bfsMaxHops).toBe(5)
    // Untouched fields still default
    expect(searchConfig.recencyHalfLifeDays).toBe(DEFAULT_SEARCH_CONFIG.recencyHalfLifeDays)
  })

  it('successive partial updates accumulate', () => {
    useSettingsStore.getState().setSearchConfig({ filenameWeight: 15 })
    useSettingsStore.getState().setSearchConfig({ bodyWeight: 2 })
    const { searchConfig } = useSettingsStore.getState()
    expect(searchConfig.filenameWeight).toBe(15)
    expect(searchConfig.bodyWeight).toBe(2)
  })
})

// ── resetSearchConfig ─────────────────────────────────────────────────────────

describe('settingsStore — resetSearchConfig()', () => {
  it('restores all search config fields to defaults', () => {
    useSettingsStore.getState().setSearchConfig({
      filenameWeight: 99,
      bodyWeight: 99,
      bfsMaxHops: 99,
    })
    useSettingsStore.getState().resetSearchConfig()
    const { searchConfig } = useSettingsStore.getState()
    expect(searchConfig).toEqual(DEFAULT_SEARCH_CONFIG)
  })

  it('does not affect other settings state', () => {
    useSettingsStore.getState().setPersonaModel('chief_director', 'gpt-4o')
    useSettingsStore.getState().setSearchConfig({ filenameWeight: 50 })
    useSettingsStore.getState().resetSearchConfig()
    expect(useSettingsStore.getState().personaModels.chief_director).toBe('gpt-4o')
    expect(useSettingsStore.getState().searchConfig.filenameWeight).toBe(DEFAULT_SEARCH_CONFIG.filenameWeight)
  })
})

// ── getApiKey ─────────────────────────────────────────────────────────────────

describe('settingsStore — getApiKey()', () => {
  beforeEach(() => {
    useSettingsStore.setState({ apiKeys: {} })
  })

  it('returns stored key when set', () => {
    useSettingsStore.getState().setApiKey('openai', 'sk-test-key-123')
    const key = getApiKey('openai')
    expect(key).toBe('sk-test-key-123')
  })

  it('returns undefined when no key is stored and no env var', () => {
    const key = getApiKey('openai')
    // No env var set in test environment, so should be undefined
    expect(key).toBeUndefined()
  })

  it('trims whitespace from stored keys', () => {
    useSettingsStore.getState().setApiKey('anthropic', '  sk-trimmed  ')
    const key = getApiKey('anthropic')
    expect(key).toBe('sk-trimmed')
  })

  it('returns correct key for different providers', () => {
    useSettingsStore.getState().setApiKey('openai', 'openai-key')
    useSettingsStore.getState().setApiKey('anthropic', 'anthropic-key')
    expect(getApiKey('openai')).toBe('openai-key')
    expect(getApiKey('anthropic')).toBe('anthropic-key')
  })
})
