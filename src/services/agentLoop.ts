/**
 * agentLoop.ts — Generic Anthropic tool-use agentic loop
 *
 * No imports from llmClient or editAgentRunner — keeps the dependency graph acyclic.
 * Both editAgentRunner and llmClient can import from here safely.
 */

import { useUsageStore } from '@/stores/usageStore'
import { AGENT_MAX_OUTPUT_TOKENS } from '@/lib/constants'

const MAX_RETRIES = 3

// ── Types ─────────────────────────────────────────────────────────────────────

export type AnthropicTool = {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export type TextBlock       = { type: 'text'; text: string }
export type ToolUseBlock    = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
export type ContentBlock    = TextBlock | ToolUseBlock
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string }
export type AgentMsg =
  | { role: 'user';      content: string | ToolResultBlock[] }
  | { role: 'assistant'; content: ContentBlock[] }

// ── HTTP retry helper ─────────────────────────────────────────────────────────

export async function fetchAnthropicWithRetry(
  url: string,
  init: RequestInit,
  onWait?: (seconds: number, attempt: number) => void,
): Promise<Response> {
  let attempt = 0
  while (true) {
    const response = await fetch(url, init)
    if (response.status !== 429 || attempt >= MAX_RETRIES) return response
    const retryAfter = response.headers.get('retry-after')
    const waitSec = retryAfter
      ? Math.min(parseInt(retryAfter, 10) || 10, 60)
      : Math.min(4 ** attempt, 60)
    onWait?.(waitSec, attempt + 1)
    await new Promise(res => setTimeout(res, waitSec * 1000))
    attempt++
  }
}

// ── runAgentLoop ──────────────────────────────────────────────────────────────

export interface AgentLoopOpts {
  systemPrompt:  string
  messages:      AgentMsg[]
  tools:         AnthropicTool[]
  /** Execute a single tool call and return the result string */
  executeTool:   (name: string, input: Record<string, unknown>, vaultPath: string) => Promise<string>
  modelId:       string
  apiKey:        string
  vaultPath:     string
  /** Usage category for usageStore (default: 'chat') */
  usageCategory?: string
  onChunk:       (text: string) => void
  onToolCall:    (name: string, input: unknown, result: string) => void
  onWait?:       (seconds: number, attempt: number) => void
  signal?:       AbortSignal
  maxIterations?: number
}

/**
 * Runs a non-streaming Anthropic tool-use loop until end_turn or maxIterations.
 * Calls onChunk for each text block and onToolCall after each tool execution.
 */
export async function runAgentLoop(opts: AgentLoopOpts): Promise<void> {
  const {
    systemPrompt, messages, tools, executeTool,
    modelId, apiKey, vaultPath,
    usageCategory = 'chat',
    onChunk, onToolCall, onWait,
    maxIterations = 30,
  } = opts

  const msgs: AgentMsg[] = [...messages]

  for (let iter = 0; iter < maxIterations; iter++) {
    if (opts.signal?.aborted) break

    const response = await fetchAnthropicWithRetry(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: AGENT_MAX_OUTPUT_TOKENS,
          system: systemPrompt,
          tools,
          messages: msgs,
        }),
        signal: opts.signal,
      },
      onWait,
    )

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Anthropic API 오류 ${response.status}: ${errText}`)
    }

    const data = await response.json() as {
      content:     ContentBlock[]
      stop_reason: 'end_turn' | 'tool_use' | 'max_tokens'
      usage:       { input_tokens: number; output_tokens: number }
    }

    if (data.usage) {
      useUsageStore.getState().recordUsage(
        modelId, data.usage.input_tokens, data.usage.output_tokens, usageCategory,
      )
    }

    msgs.push({ role: 'assistant', content: data.content })

    for (const block of data.content) {
      if (block.type === 'text' && block.text) onChunk(block.text)
    }

    if (data.stop_reason === 'end_turn' || data.stop_reason === 'max_tokens') break

    if (data.stop_reason === 'tool_use') {
      const toolBlocks = data.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
      const toolResults: ToolResultBlock[] = []
      for (const block of toolBlocks) {
        const result = await executeTool(block.name, block.input, vaultPath)
        onToolCall(block.name, block.input, result)
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
      }
      msgs.push({ role: 'user', content: toolResults })
    } else {
      // Unexpected stop_reason (e.g. 'stop_sequence') — break to avoid infinite loop
      break
    }
  }
}
