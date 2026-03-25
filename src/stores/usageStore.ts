/**
 * Session token usage tracker.
 *
 * Records cumulative input/output tokens and calculates estimated USD cost
 * based on MODEL_PRICING table. Resets on demand (e.g. session reset button).
 */
import { create } from 'zustand'

/** Per-million-token pricing (USD). Values are approximate list prices. */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-opus-4-6':             { input: 15.0,  output: 75.0  },
  'claude-sonnet-4-6':           { input: 3.0,   output: 15.0  },
  'claude-haiku-4-5-20251001':   { input: 0.8,   output: 4.0   },
  'claude-sonnet-4-5-20250514':  { input: 3.0,   output: 15.0  },
  // OpenAI
  'gpt-4.1':                     { input: 2.0,   output: 8.0   },
  'gpt-4.1-mini':                { input: 0.4,   output: 1.6   },
  'gpt-4.1-nano':                { input: 0.1,   output: 0.4   },
  'gpt-4o':                      { input: 2.5,   output: 10.0  },
  'gpt-4o-mini':                 { input: 0.15,  output: 0.6   },
  'o3':                          { input: 10.0,  output: 40.0  },
  'o3-mini':                     { input: 1.1,   output: 4.4   },
  'o4-mini':                     { input: 1.1,   output: 4.4   },
  // Google Gemini
  'gemini-2.5-pro':              { input: 1.25,  output: 10.0  },
  'gemini-2.5-flash':            { input: 0.15,  output: 0.6   },
  'gemini-2.5-flash-lite':       { input: 0.075, output: 0.3   },
  'gemini-2.0-flash':            { input: 0.1,   output: 0.4   },
  // xAI Grok
  'grok-3':                      { input: 3.0,   output: 15.0  },
  'grok-3-mini':                 { input: 0.3,   output: 0.5   },
  'grok-3-fast':                 { input: 5.0,   output: 25.0  },
}

/** Estimate USD cost for a single LLM call. Returns 0 if model unknown. */
export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[modelId]
  if (!pricing) return 0
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output
}

interface UsageState {
  /** Cumulative input tokens this session */
  totalInputTokens: number
  /** Cumulative output tokens this session */
  totalOutputTokens: number
  /** Cumulative USD cost this session */
  totalCostUsd: number

  /** Record one LLM call's token usage */
  recordUsage: (modelId: string, inputTokens: number, outputTokens: number) => void
  /** Reset all counters to zero */
  resetSession: () => void
}

export const useUsageStore = create<UsageState>()((set) => ({
  totalInputTokens:  0,
  totalOutputTokens: 0,
  totalCostUsd:      0,

  recordUsage: (modelId, inputTokens, outputTokens) =>
    set((state) => ({
      totalInputTokens:  state.totalInputTokens  + inputTokens,
      totalOutputTokens: state.totalOutputTokens + outputTokens,
      totalCostUsd:      state.totalCostUsd      + estimateCost(modelId, inputTokens, outputTokens),
    })),

  resetSession: () =>
    set({ totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 }),
}))
