/**
 * Computer Use integration for the Edit Agent.
 *
 * Two capabilities:
 *  1. Anthropic Computer Use API  — screenshots, click, type via Claude model
 *  2. gstack headless browser     — Playwright-based, installed at primdev
 *
 * gstack binary: ~/.claude/skills/gstack/browse/dist/browse
 * Commands: goto|text|snapshot|click|fill|js
 * Element refs: @e3 (from snapshot output)
 *
 * Usage in editAgentRunner:
 *   const shot = await takeScreenshot()
 *   const action = await computerUseDecide(shot, 'click the Save button')
 *   await executeComputerAction(action)
 */

import { getApiKey } from '@/stores/settingsStore'
import { DEFAULT_MODEL_ID } from '@/lib/modelConfig'
import { logger } from '@/lib/logger'

// ── Types ──────────────────────────────────────────────────────────────────────

export type ComputerAction =
  | { type: 'screenshot' }
  | { type: 'click'; x: number; y: number }
  | { type: 'type'; text: string }
  | { type: 'key'; key: string }
  | { type: 'scroll'; x: number; y: number; direction: 'up' | 'down' }

export interface ComputerUseResult {
  success: boolean
  screenshot?: string  // base64 PNG
  output?: string
  error?: string
}

// ── Anthropic Computer Use API ────────────────────────────────────────────────

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const COMPUTER_USE_MODEL = DEFAULT_MODEL_ID
const COMPUTER_USE_BETA = 'computer-use-2024-10-22'

interface ComputerUseTool {
  type: 'computer_20241022'
  name: 'computer'
  display_width_px: number
  display_height_px: number
  display_number: number
}

interface ComputerUseBlock {
  type: 'tool_use'
  id: string
  name: 'computer'
  input: {
    action: string
    coordinate?: [number, number]
    text?: string
    key?: string
    direction?: string
    amount?: number
  }
}

/**
 * Ask Claude to decide what computer action to take given a screenshot and goal.
 * Returns the raw API response for the caller to execute.
 */
export async function computerUseDecide(
  screenshotBase64: string,
  goal: string,
  displayWidth = 1920,
  displayHeight = 1080,
): Promise<ComputerUseBlock | null> {
  const apiKey = getApiKey('anthropic')
  if (!apiKey) {
    logger.warn('[ComputerUse] No Anthropic API key')
    return null
  }

  const tool: ComputerUseTool = {
    type: 'computer_20241022',
    name: 'computer',
    display_width_px: displayWidth,
    display_height_px: displayHeight,
    display_number: 0,
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': COMPUTER_USE_BETA,
    },
    body: JSON.stringify({
      model: COMPUTER_USE_MODEL,
      max_tokens: 1024,
      tools: [tool],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 },
            },
            { type: 'text', text: goal },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    logger.error(`[ComputerUse] API error ${response.status}: ${err}`)
    return null
  }

  const data = await response.json() as { content: Array<{ type: string } & Partial<ComputerUseBlock>> }
  const toolBlock = data.content.find(b => b.type === 'tool_use') as ComputerUseBlock | undefined
  return toolBlock ?? null
}

// ── gstack browser integration ─────────────────────────────────────────────────
// @experimental — STUB ONLY. Requires Electron main-process IPC handler for
//   the gstack binary (c:\dev2\primdev, ~/.claude/skills/gstack/browse/dist/browse).
//   Without the main-process handler, gstackExecute sends IPC but receives no reply.
//   Commands: goto|text|snapshot|click|fill|js
//   Element refs: @e3 (from snapshot output)

export interface GstackResult {
  success: boolean
  output: string
  error?: string
}

/** Detect how to call gstack in Electron environment */
async function gstackAvailable(): Promise<boolean> {
  return typeof window !== 'undefined' && !!window.electronAPI?.isElectron
}

/**
 * Execute a gstack browser command via the Electron main process.
 * Only available in Electron (uses Node.js child_process under the hood).
 *
 * @experimental This is a stub — the Electron main process must register a
 *   handler for the `'gstack'` IPC channel to actually invoke the binary.
 *   Until that handler exists, the command is sent but no response is returned.
 *
 * @param command  One of: goto, text, snapshot, click, fill, js
 * @param args     Command arguments (e.g., ["https://example.com"] or ["@e3", "value"])
 */
export async function gstackExecute(
  command: 'goto' | 'text' | 'snapshot' | 'click' | 'fill' | 'js',
  args: string[],
): Promise<GstackResult> {
  if (!(await gstackAvailable())) {
    return { success: false, output: '', error: 'Only available in Electron environment' }
  }

  const gstackAPI = window.gstackAPI
  if (!gstackAPI) {
    return { success: false, output: '', error: 'gstackAPI IPC bridge not available' }
  }

  try {
    logger.debug(`[gstack] ${command} ${args.join(' ')}`)
    return await gstackAPI.execute(command, args)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, output: '', error: msg }
  }
}

/**
 * Navigate gstack browser to a URL.
 */
export const gstackGoto = (url: string) => gstackExecute('goto', [url])

/**
 * Take a gstack snapshot of the current page.
 * Returns accessibility tree text that contains @e3 element references.
 */
export const gstackSnapshot = () => gstackExecute('snapshot', [])

/**
 * Click an element by its @e3 reference from a snapshot.
 */
export const gstackClick = (ref: string) => gstackExecute('click', [ref])

/**
 * Fill a form field by @e3 reference.
 */
export const gstackFill = (ref: string, value: string) => gstackExecute('fill', [ref, value])

/**
 * Execute JavaScript in the browser context.
 */
export const gstackJs = (script: string) => gstackExecute('js', [script])

/**
 * Get text content of the current page.
 */
export const gstackText = () => gstackExecute('text', [])
