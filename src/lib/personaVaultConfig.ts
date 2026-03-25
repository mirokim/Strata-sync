/**
 * personaVaultConfig.ts
 *
 * Serialize / deserialize the vault-scoped persona config file.
 * Stored at: {vaultPath}/.strata-sync/personas.md
 *
 * Format: YAML frontmatter (gray-matter) with a short markdown comment body.
 */

import matter from 'gray-matter'
import type { CustomPersona } from '@/stores/settingsStore'
import type { DirectorId } from '@/types'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface VaultPersonaConfig {
  version: number
  /** Built-in persona IDs that are hidden for this project */
  disabledPersonaIds: string[]
  /** Per-director bio / characteristic notes */
  directorBios: Partial<Record<DirectorId, string>>
  /** Per-persona model selection */
  personaModels: Record<string, string>
  /** System prompt overrides for built-in director personas */
  personaPromptOverrides: Record<string, string>
  /** User-defined additional personas */
  customPersonas: CustomPersona[]
}

const FILE_BODY =
  '\n<!-- STRATA SYNC persona config file — managed automatically by the app. -->\n'

// ── Parse ──────────────────────────────────────────────────────────────────────

export function parsePersonaConfig(content: string): VaultPersonaConfig | null {
  if (!content.trim().startsWith('---')) return null
  try {
    const { data } = matter(content)
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return null
    return {
      version: typeof data.version === 'number' ? data.version : 1,
      disabledPersonaIds: Array.isArray(data.disabledPersonaIds)
        ? (data.disabledPersonaIds as string[])
        : [],
      directorBios:
        data.directorBios && typeof data.directorBios === 'object'
          ? (data.directorBios as Partial<Record<DirectorId, string>>)
          : {},
      personaModels:
        data.personaModels && typeof data.personaModels === 'object'
          ? (data.personaModels as Record<string, string>)
          : {},
      personaPromptOverrides:
        data.personaPromptOverrides && typeof data.personaPromptOverrides === 'object'
          ? (data.personaPromptOverrides as Record<string, string>)
          : {},
      customPersonas: Array.isArray(data.customPersonas)
        ? (data.customPersonas as CustomPersona[])
        : [],
    }
  } catch {
    return null
  }
}

// ── Stringify ──────────────────────────────────────────────────────────────────

export function stringifyPersonaConfig(config: VaultPersonaConfig): string {
  return matter.stringify(FILE_BODY, config as unknown as Record<string, unknown>)
}
