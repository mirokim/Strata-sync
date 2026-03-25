/**
 * Edit Agent scheduler hook.
 *
 * Wakes up on the configured interval and runs a file refinement cycle.
 *
 * Usage: call `useEditAgent()` once at the App level.
 */

import { useEffect, useRef } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useVaultStore } from '@/stores/vaultStore'
import { runEditAgentCycle } from '@/services/editAgentRunner'
import { logger } from '@/lib/logger'

export function useEditAgent() {
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const isRunningRef = useRef(false)
  const isMountedRef = useRef(true)

  const enabled         = useSettingsStore(s => s.editAgentConfig.enabled)
  const intervalMinutes = useSettingsStore(s => s.editAgentConfig.intervalMinutes)
  const vaultPath       = useVaultStore(s => s.vaultPath)

  // Track mount state so async cycles can bail out after unmount
  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    // Don't schedule if disabled, no vault, or invalid interval
    if (!enabled || !vaultPath || !intervalMinutes || intervalMinutes < 1) return

    const intervalMs = intervalMinutes * 60 * 1000

    const runCycle = async () => {
      if (!isMountedRef.current || isRunningRef.current) {
        if (!isMountedRef.current) logger.debug('[EditAgent] Unmounted — skipping cycle')
        else logger.debug('[EditAgent] Previous cycle still running — skipping')
        return
      }
      isRunningRef.current = true
      try {
        await runEditAgentCycle()
      } catch (err) {
        logger.error('[EditAgent] Unexpected error:', err)
      } finally {
        if (isMountedRef.current) isRunningRef.current = false
      }
    }

    intervalRef.current = setInterval(runCycle, intervalMs)
    logger.debug(`[EditAgent] Scheduler started: ${intervalMinutes} minute interval`)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [enabled, intervalMinutes, vaultPath])
}
