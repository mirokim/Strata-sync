import { describe, it, expect } from 'vitest'
import { SPEAKER_CONFIG, SPEAKER_IDS } from '@/lib/speakerConfig'
import type { SpeakerId } from '@/types'

const EXPECTED_SPEAKERS: SpeakerId[] = [
  'chief_director',
  'art_director',
  'plan_director',
  'level_director',
  'prog_director',
]

describe('SPEAKER_CONFIG', () => {
  it('has 5 named director entries plus unknown (6 total)', () => {
    // Phase 6: 'unknown' was added as a fallback for vault docs without speaker frontmatter
    expect(Object.keys(SPEAKER_CONFIG)).toHaveLength(6)
    expect(SPEAKER_CONFIG).toHaveProperty('unknown')
  })

  it('contains all expected speaker IDs', () => {
    for (const id of EXPECTED_SPEAKERS) {
      expect(SPEAKER_CONFIG).toHaveProperty(id)
    }
  })

  it('every speaker has a non-empty label', () => {
    for (const id of EXPECTED_SPEAKERS) {
      expect(SPEAKER_CONFIG[id].label.length).toBeGreaterThan(0)
    }
  })

  it('every speaker has a valid CSS hex color (starts with #)', () => {
    for (const id of EXPECTED_SPEAKERS) {
      expect(SPEAKER_CONFIG[id].color).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('every speaker has a valid Three.js hex number', () => {
    for (const id of EXPECTED_SPEAKERS) {
      const hex = SPEAKER_CONFIG[id].hex
      expect(typeof hex).toBe('number')
      expect(hex).toBeGreaterThanOrEqual(0)
      expect(hex).toBeLessThanOrEqual(0xffffff)
    }
  })

  it('every speaker has a non-empty darkBg', () => {
    for (const id of EXPECTED_SPEAKERS) {
      expect(SPEAKER_CONFIG[id].darkBg.length).toBeGreaterThan(0)
    }
  })

  it('CSS color and Three.js hex are consistent', () => {
    for (const id of EXPECTED_SPEAKERS) {
      const { color, hex } = SPEAKER_CONFIG[id]
      // Parse CSS color and compare to Three.js hex
      const cssHex = parseInt(color.slice(1), 16)
      expect(cssHex).toBe(hex)
    }
  })
})

describe('SPEAKER_IDS', () => {
  it('is an array of all 5 speaker IDs', () => {
    expect(SPEAKER_IDS).toHaveLength(5)
    for (const id of EXPECTED_SPEAKERS) {
      expect(SPEAKER_IDS).toContain(id)
    }
  })
})
