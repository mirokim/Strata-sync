import type { DirectorId } from '@/types'

// ── Provider identity ─────────────────────────────────────────────────────────

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'grok'

// ── Model catalogue ───────────────────────────────────────────────────────────

export interface ModelOption {
  id: string
  label: string
  provider: ProviderId
}

export const MODEL_OPTIONS: ModelOption[] = [
  // ── Anthropic (Claude) ──
  { id: 'claude-opus-4-6',            label: 'Claude Opus 4.6',       provider: 'anthropic' },
  { id: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6',     provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5',      provider: 'anthropic' },
  { id: 'claude-sonnet-4-5-20250514', label: 'Claude Sonnet 4.5',     provider: 'anthropic' },

  // ── OpenAI (GPT) ──
  { id: 'gpt-4.1',                    label: 'GPT-4.1',               provider: 'openai'    },
  { id: 'gpt-4.1-mini',               label: 'GPT-4.1 Mini',          provider: 'openai'    },
  { id: 'gpt-4o',                     label: 'GPT-4o',                provider: 'openai'    },
  { id: 'o3',                         label: 'o3',                    provider: 'openai'    },
  { id: 'o4-mini',                    label: 'o4-mini',               provider: 'openai'    },

  // ── Google (Gemini) ──
  { id: 'gemini-2.5-pro',             label: 'Gemini 2.5 Pro',        provider: 'gemini'    },
  { id: 'gemini-2.5-flash',           label: 'Gemini 2.5 Flash',      provider: 'gemini'    },
  { id: 'gemini-2.5-flash-lite',      label: 'Gemini 2.5 Flash Lite', provider: 'gemini'    },

  // ── xAI (Grok) ──
  { id: 'grok-3',                     label: 'Grok 3',                provider: 'grok'      },
  { id: 'grok-3-mini',                label: 'Grok 3 Mini',           provider: 'grok'      },
]

// ── Default persona → model mapping ──────────────────────────────────────────

export const DEFAULT_PERSONA_MODELS: Record<DirectorId, string> = {
  chief_director: 'claude-sonnet-4-6',
  art_director:   'gpt-4.1',
  plan_director:  'gemini-2.5-flash',
  level_director: 'grok-3',
  prog_director:  'claude-haiku-4-5-20251001',
}

// ── Helper ────────────────────────────────────────────────────────────────────

/** Get provider for a given model ID. Returns undefined if model not found. */
export function getProviderForModel(modelId: string): ProviderId | undefined {
  return MODEL_OPTIONS.find((m) => m.id === modelId)?.provider
}

/** Get VITE env var name for a given provider */
export function envKeyForProvider(provider: ProviderId): string {
  return `VITE_${provider.toUpperCase()}_API_KEY`
}
