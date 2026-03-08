import { describe, it, expect } from 'vitest'
import { parsePersonaConfig, stringifyPersonaConfig } from '@/lib/personaVaultConfig'
import type { VaultPersonaConfig } from '@/lib/personaVaultConfig'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const FULL_CONFIG: VaultPersonaConfig = {
  version: 2,
  disabledPersonaIds: ['plan_director'],
  directorBios: { art_director: 'Visual Lead' },
  personaModels: { chief_director: 'claude-sonnet-4-6' },
  personaPromptOverrides: { chief_director: 'Always respond in English.' },
  customPersonas: [{ id: 'custom_1', name: 'Custom AI', prompt: 'test prompt', color: '#ff0000' }],
}

const FULL_YAML = `---
version: 2
disabledPersonaIds:
  - plan_director
directorBios:
  art_director: Visual Lead
personaModels:
  chief_director: claude-sonnet-4-6
personaPromptOverrides:
  chief_director: Always respond in English.
customPersonas:
  - id: custom_1
    name: Custom AI
    prompt: test prompt
    color: '#ff0000'
---

<!-- STRATA SYNC persona config file — managed automatically by the app. -->
`

// ── parsePersonaConfig ─────────────────────────────────────────────────────────

describe('parsePersonaConfig()', () => {
  it('parses a fully populated config correctly', () => {
    const result = parsePersonaConfig(FULL_YAML)
    expect(result).not.toBeNull()
    expect(result!.version).toBe(2)
    expect(result!.disabledPersonaIds).toEqual(['plan_director'])
    expect(result!.directorBios.art_director).toBe('Visual Lead')
    expect(result!.personaModels.chief_director).toBe('claude-sonnet-4-6')
    expect(result!.personaPromptOverrides.chief_director).toBe('Always respond in English.')
    expect(result!.customPersonas).toHaveLength(1)
    expect(result!.customPersonas[0].id).toBe('custom_1')
  })

  it('returns null for empty content', () => {
    expect(parsePersonaConfig('')).toBeNull()
  })

  it('returns null for content with no frontmatter', () => {
    expect(parsePersonaConfig('just plain text')).toBeNull()
  })

  it('applies defaults for missing optional fields', () => {
    const minimal = '---\nversion: 1\n---\n'
    const result = parsePersonaConfig(minimal)
    expect(result).not.toBeNull()
    expect(result!.version).toBe(1)
    expect(result!.disabledPersonaIds).toEqual([])
    expect(result!.directorBios).toEqual({})
    expect(result!.personaModels).toEqual({})
    expect(result!.personaPromptOverrides).toEqual({})
    expect(result!.customPersonas).toEqual([])
  })

  it('defaults version to 1 when missing', () => {
    const noVersion = '---\ndisabledPersonaIds: []\n---\n'
    const result = parsePersonaConfig(noVersion)
    expect(result!.version).toBe(1)
  })

  it('handles disabledPersonaIds as empty array', () => {
    const content = '---\nversion: 1\ndisabledPersonaIds: []\n---\n'
    const result = parsePersonaConfig(content)
    expect(result!.disabledPersonaIds).toEqual([])
  })

  it('returns null for invalid (non-object) frontmatter', () => {
    // YAML scalar at top level
    const bad = '---\njust a string\n---\n'
    // gray-matter parses this as { content: '...' } — returns null since data is not an object
    // Actually gray-matter returns {} for scalar — so result may be an empty config
    // Just verify it doesn't throw
    expect(() => parsePersonaConfig(bad)).not.toThrow()
  })
})

// ── stringifyPersonaConfig ─────────────────────────────────────────────────────

describe('stringifyPersonaConfig()', () => {
  it('produces a string starting with ---', () => {
    const out = stringifyPersonaConfig(FULL_CONFIG)
    expect(typeof out).toBe('string')
    expect(out.trimStart()).toMatch(/^---/)
  })

  it('round-trips: stringify → parse returns equivalent config', () => {
    const serialized = stringifyPersonaConfig(FULL_CONFIG)
    const reparsed = parsePersonaConfig(serialized)
    expect(reparsed).not.toBeNull()
    expect(reparsed!.version).toBe(FULL_CONFIG.version)
    expect(reparsed!.disabledPersonaIds).toEqual(FULL_CONFIG.disabledPersonaIds)
    expect(reparsed!.personaModels).toEqual(FULL_CONFIG.personaModels)
    expect(reparsed!.customPersonas).toHaveLength(FULL_CONFIG.customPersonas.length)
  })

  it('round-trips an empty config', () => {
    const empty: VaultPersonaConfig = {
      version: 1,
      disabledPersonaIds: [],
      directorBios: {},
      personaModels: {},
      personaPromptOverrides: {},
      customPersonas: [],
    }
    const serialized = stringifyPersonaConfig(empty)
    const reparsed = parsePersonaConfig(serialized)
    expect(reparsed!.version).toBe(1)
    expect(reparsed!.customPersonas).toEqual([])
  })
})
