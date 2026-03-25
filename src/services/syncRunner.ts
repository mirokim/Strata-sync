// TODO: Wire up — currently not imported by any consumer
/**
 * syncRunner.ts — Generic sync orchestration framework.
 *
 * Provides utility functions for running post-sync scripts and quality checks.
 * Called from the Edit Agent wake cycle or other sync workflows.
 */

import { useVaultStore } from '@/stores/vaultStore'
import { logger } from '@/lib/logger'
import type { EditAgentState } from '@/stores/editAgentStore'

type ScriptResult = { exitCode: number; stderr?: string; stdout?: string }
type ScriptAPI = { runScript?: (n: string, a: string[]) => Promise<ScriptResult> }

function getScriptAPI(): ScriptAPI | undefined {
  return window.confluenceAPI as ScriptAPI | undefined
}

/**
 * Run post-sync scripts defined in the script configuration.
 * Each script receives the vault path as argument.
 */
export async function runPostSyncScripts(vaultPath: string, store: EditAgentState): Promise<void> {
  const api = getScriptAPI()
  if (typeof api?.runScript !== 'function') return
  // Post-sync script execution placeholder
  // Add custom scripts here as needed
}

/**
 * Run the quality check script and surface key metrics to EditAgentLog.
 * Extracts only WARN items and total issue count for brevity.
 */
export async function runQualityCheck(vaultPath: string, store: EditAgentState): Promise<void> {
  const api = getScriptAPI()
  if (typeof api?.runScript !== 'function') return
  try {
    const r = await api.runScript('check_quality.py', [vaultPath, '--vault', vaultPath])
    if (!r?.stdout) return
    const lines = r.stdout.split('\n')
    // Total issue count (summary line)
    const summaryLine = lines.find(l => l.includes('issues'))
    if (summaryLine) store.addLog({ action: 'diff_check', detail: `Quality: ${summaryLine.trim()}` })
    // Extract only WARN items (max 5)
    const warnLines = lines.filter(l => l.startsWith('[WARN]')).slice(0, 5)
    for (const w of warnLines) {
      store.addLog({ action: 'error', detail: w.trim() })
    }
  } catch (e) {
    logger.warn('[syncRunner] check_quality failed:', e)
  }
}

/**
 * Generic notification helper for sync completion events.
 */
export function notifySyncComplete(
  source: string,
  count: number,
  store: EditAgentState,
): void {
  store.addLog({
    action: 'file_edit',
    detail: `${source}: ${count} items synced`,
  })
}
