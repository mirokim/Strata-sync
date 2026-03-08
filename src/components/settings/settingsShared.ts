/**
 * settingsShared.ts — Shared constants and style helpers for Settings tabs.
 */

import type React from 'react'
import { MODEL_OPTIONS } from '@/lib/modelConfig'

// ── Grouped model options ─────────────────────────────────────────────────────

export const GROUPED_OPTIONS = MODEL_OPTIONS.reduce<Record<string, typeof MODEL_OPTIONS>>(
  (acc, m) => { if (!acc[m.provider]) acc[m.provider] = []; acc[m.provider].push(m); return acc },
  {}
)

export const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai:    'OpenAI (GPT)',
  gemini:    'Google (Gemini)',
  grok:      'xAI (Grok)',
}

// ── Shared field style helpers ─────────────────────────────────────────────────

export const fieldInputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--color-bg-surface)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border)',
  borderRadius: 5,
  padding: '5px 8px',
  fontSize: 12,
  outline: 'none',
  fontFamily: 'inherit',
}

export const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-muted)',
  marginBottom: 4,
  display: 'block',
}
