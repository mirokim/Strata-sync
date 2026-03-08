import { useState } from 'react'
import { useSettingsStore, DEFAULT_RESPONSE_INSTRUCTIONS, DEFAULT_RAG_INSTRUCTION } from '@/stores/settingsStore'
import { MODEL_OPTIONS, type ProviderId } from '@/lib/modelConfig'
import { SPEAKER_CONFIG, SPEAKER_IDS } from '@/lib/speakerConfig'
import type { DirectorId } from '@/types'
import { GROUPED_OPTIONS, PROVIDER_LABELS } from '../settingsShared'

// ── Local helpers ─────────────────────────────────────────────────────────────

const API_KEY_PROVIDERS: { id: ProviderId; label: string; placeholder: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)',  placeholder: 'sk-ant-...' },
  { id: 'openai',    label: 'OpenAI (GPT)',        placeholder: 'sk-...' },
  { id: 'gemini',    label: 'Google (Gemini)',      placeholder: 'AIza...' },
  { id: 'grok',      label: 'xAI (Grok)',          placeholder: 'xai-...' },
]

function EnvHint({ provider }: { provider: string }) {
  const storeKey = useSettingsStore(s => s.apiKeys[provider as ProviderId])
  const hasKey = Boolean(storeKey) || Boolean((import.meta.env as Record<string, string>)[`VITE_${provider.toUpperCase()}_API_KEY`])
  return (
    <span
      className="text-[10px] ml-1 shrink-0"
      style={{ color: hasKey ? '#4caf50' : 'var(--color-text-muted)' }}
      title={hasKey ? 'API key configured' : 'API key not configured'}
    >
      {hasKey ? '●' : '○'}
    </span>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AITab() {
  const { personaModels, setPersonaModel, apiKeys, setApiKey, responseInstructions, setResponseInstructions, ragInstruction, setRagInstruction, reportModelId, setReportModelId, multiAgentRAG, setMultiAgentRAG } = useSettingsStore()
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})

  const toggleKeyVisibility = (id: string) =>
    setVisibleKeys(prev => ({ ...prev, [id]: !prev[id] }))

  return (
    <div className="flex flex-col gap-5" data-testid="model-section">

      {/* API Keys */}
      <section>
        <h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>API Keys</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
          Enter each AI provider's API key. Keys are saved in browser local storage.
        </p>
        <div className="flex flex-col gap-2.5">
          {API_KEY_PROVIDERS.map(({ id, label, placeholder }) => {
            const hasEnv = Boolean((import.meta.env as Record<string, string>)[`VITE_${id.toUpperCase()}_API_KEY`])
            const storeValue = apiKeys[id] ?? ''
            const hasKey = Boolean(storeValue) || hasEnv
            return (
              <div key={id} className="flex items-center gap-2">
                <div
                  className="shrink-0 text-[11px] font-medium"
                  style={{ color: 'var(--color-text-secondary)', minWidth: 120 }}
                >
                  {label}
                  <span
                    className="text-[10px] ml-1.5"
                    style={{ color: hasKey ? '#4caf50' : 'var(--color-text-muted)' }}
                  >{hasKey ? '●' : '○'}</span>
                </div>
                <div className="flex-1 relative">
                  <input
                    type={visibleKeys[id] ? 'text' : 'password'}
                    value={storeValue}
                    onChange={e => setApiKey(id, e.target.value)}
                    placeholder={hasEnv ? '(using environment variable)' : placeholder}
                    className="w-full text-xs rounded px-2 py-1.5 pr-7 font-mono"
                    style={{
                      background: 'var(--color-bg-surface)',
                      color: 'var(--color-text-primary)',
                      border: '1px solid var(--color-border)',
                      outline: 'none',
                    }}
                    autoComplete="off"
                    data-testid={`api-key-${id}`}
                  />
                  <button
                    type="button"
                    onClick={() => toggleKeyVisibility(id)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] px-1"
                    style={{ color: 'var(--color-text-muted)' }}
                    tabIndex={-1}
                  >
                    {visibleKeys[id] ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Persona → model mapping */}
      <section>
        <h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>Persona Models</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
          Select the AI model to use for each director persona. When no API key is configured, mock responses are used.
        </p>
        <div className="flex flex-col gap-2.5">
          {SPEAKER_IDS.map(persona => {
            const meta = SPEAKER_CONFIG[persona]
            const selectedModel = personaModels[persona]
            const currentProvider = MODEL_OPTIONS.find(m => m.id === selectedModel)?.provider ?? ''

            return (
              <div
                key={persona}
                className="flex items-center gap-3"
                data-testid={`persona-row-${persona}`}
              >
                {/* Persona chip */}
                <div
                  className="shrink-0 text-xs px-2 py-1 rounded font-mono"
                  style={{ background: meta.darkBg, color: meta.color, minWidth: 44, textAlign: 'center' }}
                >
                  {meta.label}
                </div>

                {/* Model select */}
                <div className="flex-1 relative">
                  <select
                    value={selectedModel}
                    onChange={e => setPersonaModel(persona as DirectorId, e.target.value)}
                    className="w-full text-xs rounded px-2 py-1.5 appearance-none pr-6"
                    style={{
                      background: 'var(--color-bg-surface)',
                      color: 'var(--color-text-primary)',
                      border: '1px solid var(--color-border)',
                      outline: 'none',
                    }}
                    aria-label={`${meta.label} model`}
                    data-testid={`model-select-${persona}`}
                  >
                    {Object.entries(GROUPED_OPTIONS).map(([provider, models]) => (
                      <optgroup key={provider} label={PROVIDER_LABELS[provider] ?? provider}>
                        {models.map(m => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <span
                    className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[10px]"
                    style={{ color: 'var(--color-text-muted)' }}
                  >▾</span>
                </div>

                <EnvHint provider={currentProvider} />
              </div>
            )
          })}
        </div>
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Report model */}
      <section>
        <h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>Report AI Model</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
          Select the model used when AI summarizes and generates conversation reports. Selecting "Disabled" outputs the conversation as plain markdown.
        </p>
        <div className="relative">
          <select
            value={reportModelId}
            onChange={e => setReportModelId(e.target.value)}
            className="w-full text-xs rounded px-2 py-1.5 appearance-none pr-6"
            style={{
              background: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
              outline: 'none',
            }}
          >
            <option value="">Disabled (output default format)</option>
            {Object.entries(GROUPED_OPTIONS).map(([provider, models]) => (
              <optgroup key={provider} label={PROVIDER_LABELS[provider] ?? provider}>
                {models.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <span
            className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[10px]"
            style={{ color: 'var(--color-text-muted)' }}
          >▾</span>
        </div>
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* RAG document instruction */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            RAG Document Reference Guidelines
          </h3>
          <button
            onClick={() => setRagInstruction(DEFAULT_RAG_INSTRUCTION)}
            className="text-[10px] px-2 py-0.5 rounded"
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
            }}
            title="Restore to defaults"
          >
            Restore Defaults
          </button>
        </div>
        <p className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
          Reference principles applied when delivering vault documents to the AI. Configures latest-data priority, factual accuracy, and insight extraction.
        </p>
        <textarea
          value={ragInstruction}
          onChange={e => setRagInstruction(e.target.value)}
          rows={10}
          spellCheck={false}
          style={{
            width: '100%',
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 5,
            padding: '7px 9px',
            fontSize: 11,
            fontFamily: 'ui-monospace, monospace',
            color: 'var(--color-text-primary)',
            resize: 'vertical',
            lineHeight: 1.6,
            outline: 'none',
          }}
          placeholder="e.g. - Always prioritize the most recent documents."
        />
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Response instructions */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            AI Response Guidelines
          </h3>
          <button
            onClick={() => setResponseInstructions(DEFAULT_RESPONSE_INSTRUCTIONS)}
            className="text-[10px] px-2 py-0.5 rounded"
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
            }}
            title="Restore to default response guidelines"
          >
            Restore Defaults
          </button>
        </div>
        <p className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
          Response format and tone guidelines applied to all personas. Edit or add items as needed.
        </p>
      {/* Multi-agent RAG toggle */}
      <div className="flex items-center justify-between py-2">
        <div>
          <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Multi-agent RAG
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Related documents are summarized in parallel by a cheap Worker model, then passed to the Chief. Improves response quality at a slight latency cost.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={multiAgentRAG}
          onClick={() => setMultiAgentRAG(!multiAgentRAG)}
          className="shrink-0 ml-4 w-9 h-5 rounded-full transition-colors"
          style={{
            background: multiAgentRAG ? 'var(--color-accent)' : 'var(--color-bg-hover)',
            border: '1px solid var(--color-border)',
          }}
        >
          <span
            className="block w-3.5 h-3.5 rounded-full bg-white transition-transform"
            style={{ transform: multiAgentRAG ? 'translateX(18px)' : 'translateX(2px)', marginTop: 2 }}
          />
        </button>
      </div>

        <textarea
          value={responseInstructions}
          onChange={e => setResponseInstructions(e.target.value)}
          rows={8}
          spellCheck={false}
          style={{
            width: '100%',
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 5,
            padding: '7px 9px',
            fontSize: 11,
            fontFamily: 'ui-monospace, monospace',
            color: 'var(--color-text-primary)',
            resize: 'vertical',
            lineHeight: 1.6,
            outline: 'none',
          }}
          placeholder="e.g. - Always summarize the answer within 3 lines."
        />
      </section>
    </div>
  )
}
