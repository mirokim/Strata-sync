/**
 * logger.ts — conditional logger
 *
 * Outputs debug/warn logs in development environments only.
 * Errors are always output (for production error tracking).
 *
 * Usage:
 *   import { logger } from '@/lib/logger'
 *   logger.debug('[vault] loaded', files.length)
 *   logger.error('[vault] failed:', err)
 */

const isDev = import.meta.env.DEV

export const logger = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug: (...args: any[]) => { if (isDev) console.log(...args) },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn:  (...args: any[]) => { if (isDev) console.warn(...args) },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: (...args: any[]) => { console.error(...args) },
}
