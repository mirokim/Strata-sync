/**
 * Shared formatting utilities.
 * Single source of truth — used by StatusBar, UsageTab, editAgentRunner, etc.
 */

/** Format a token count as human-readable string (e.g. 1.2K, 3.5M) */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

/** Format a USD cost with appropriate precision */
export function formatCost(usd: number): string {
  if (usd === 0)   return '$0.000'
  if (usd < 0.001) return '<$0.001'
  if (usd < 1)     return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

/** Zero-pad a number to 2 digits: 3 → "03" */
export function padZero(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local date as YYYY-MM-DD (based on local system time) */
export function formatLocalDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${padZero(d.getMonth() + 1)}-${padZero(d.getDate())}`
}

/** ISO timestamp → "YYYY-MM-DD HH:mm" (UTC) for sync date filtering */
export function toSyncDatetime(iso: string | null, fallback: string): string {
  if (!iso) return fallback
  const d = new Date(iso)
  if (isNaN(d.getTime())) return fallback
  return `${d.getUTCFullYear()}-${padZero(d.getUTCMonth() + 1)}-${padZero(d.getUTCDate())} ${padZero(d.getUTCHours())}:${padZero(d.getUTCMinutes())}`
}
