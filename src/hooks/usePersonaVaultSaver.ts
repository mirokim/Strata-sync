/**
 * usePersonaVaultSaver
 *
 * Watches persona-related settings changes and debounce-saves them to
 * {vaultPath}/.strata-sync/personas.md whenever a vault is active.
 *
 * This makes persona config per-project: each vault stores its own config file.
 */

import { useEffect, useRef } from 'react'
import { PERSONA_CONFIG_PATH } from '@/lib/constants'
import { logger } from '@/lib/logger'
import { useSettingsStore } from '@/stores/settingsStore'
import { useVaultStore } from '@/stores/vaultStore'
import { stringifyPersonaConfig, type VaultPersonaConfig } from '@/lib/personaVaultConfig'

const DEBOUNCE_MS = 1200

export function usePersonaVaultSaver() {
  const vaultPath = useVaultStore(s => s.vaultPath)
  const customPersonas = useSettingsStore(s => s.customPersonas)
  const personaPromptOverrides = useSettingsStore(s => s.personaPromptOverrides)
  const disabledPersonaIds = useSettingsStore(s => s.disabledPersonaIds)
  const directorBios = useSettingsStore(s => s.directorBios)
  const personaModels = useSettingsStore(s => s.personaModels)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!vaultPath || !window.vaultAPI?.saveFile) return

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      const config: VaultPersonaConfig = {
        version: 1,
        disabledPersonaIds,
        directorBios,
        personaModels,
        personaPromptOverrides,
        customPersonas,
      }
      const content = stringifyPersonaConfig(config)
      const configPath = `${vaultPath}/${PERSONA_CONFIG_PATH}`
      try {
        await window.vaultAPI!.saveFile(configPath, content)
        logger.debug('[persona] vault config saved:', configPath)
      } catch (err) {
        logger.warn('[persona] vault config save failed:', err)
      }
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [vaultPath, customPersonas, personaPromptOverrides, disabledPersonaIds, directorBios, personaModels])
}
