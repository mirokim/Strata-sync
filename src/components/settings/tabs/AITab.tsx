import { useState } from 'react'
import { useSettingsStore, DEFAULT_RESPONSE_INSTRUCTIONS, DEFAULT_RAG_INSTRUCTION } from '@/stores/settingsStore'
import { MODEL_OPTIONS } from '@/lib/modelConfig'
import { SPEAKER_CONFIG, SPEAKER_IDS } from '@/lib/speakerConfig'
import type { DirectorId, ProviderId } from '@/types'
import { GROUPED_OPTIONS, PROVIDER_LABELS, PROVIDER_PLACEHOLDERS } from '../settingsShared'

// ── Local helpers ─────────────────────────────────────────────────────────────

const API_KEY_PROVIDERS: { id: ProviderId; label: string; placeholder: string }[] = (
  Object.keys(PROVIDER_LABELS) as ProviderId[]
).map(id => ({ id, label: PROVIDER_LABELS[id], placeholder: PROVIDER_PLACEHOLDERS[id] }))

function EnvHint({ provider }: { provider: string }) {
  const storeKey = useSettingsStore(s => s.apiKeys[provider as ProviderId])
  const hasKey = Boolean(storeKey) || Boolean((import.meta.env as Record<string, string>)[`VITE_${provider.toUpperCase()}_API_KEY`])
  return (
    <span
      className="text-[10px] ml-1 shrink-0"
      style={{ color: hasKey ? '#4caf50' : 'var(--color-text-muted)' }}
      title={hasKey ? 'API 키 설정됨' : 'API 키 미설정'}
    >
      {hasKey ? '●' : '○'}
    </span>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AITab() {
  const { personaModels, setPersonaModel, apiKeys, setApiKey, responseInstructions, setResponseInstructions, ragInstruction, setRagInstruction, reportModelId, setReportModelId, multiAgentRAG, setMultiAgentRAG, webSearch, setWebSearch, citationMode, setCitationMode, sensitiveKeywords, setSensitiveKeywords, selfReview, setSelfReview, nAgents, setNAgents } = useSettingsStore()
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})

  const toggleKeyVisibility = (id: string) =>
    setVisibleKeys(prev => ({ ...prev, [id]: !prev[id] }))

  return (
    <div className="flex flex-col gap-5" data-testid="model-section">

      {/* API Keys */}
      <section>
        <h3 className="text-[13px] font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>API 키</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
          각 AI 제공자의 API 키를 입력하세요.{' '}
          <span style={{ color: '#f59e0b' }}>⚠ 키는 이 기기의 로컬 스토리지에 평문 저장됩니다. 공용 컴퓨터에서는 사용 후 키를 삭제하세요.</span>
        </p>
        <div className="flex flex-col gap-2.5">
          {API_KEY_PROVIDERS.map(({ id, label, placeholder }) => {
            const hasEnv = Boolean((import.meta.env as Record<string, string>)[`VITE_${id.toUpperCase()}_API_KEY`])
            const storeValue = apiKeys[id] ?? ''
            const hasKey = Boolean(storeValue) || hasEnv
            return (
              <div key={id} className="flex items-center gap-2">
                <div
                  className="shrink-0 text-[13px] font-medium"
                  style={{ color: 'var(--color-text-secondary)', minWidth: 130 }}
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
                    onChange={e => setApiKey(id, e.target.value.trim())}
                    placeholder={hasEnv ? '(환경변수 사용 중)' : placeholder}
                    className="w-full text-[13px] rounded px-2 py-1.5 pr-7 font-mono"
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
                    {visibleKeys[id] ? '숨김' : '보기'}
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
        <h3 className="text-[13px] font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>페르소나 모델</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
          각 디렉터 페르소나에 사용할 AI 모델을 선택하세요. API 키 미설정 시 Mock 응답을 사용합니다.
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
                    className="w-full text-[13px] rounded px-2 py-1.5 appearance-none pr-6"
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
                      <optgroup key={provider} label={PROVIDER_LABELS[provider as keyof typeof PROVIDER_LABELS] ?? provider}>
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
        <h3 className="text-[13px] font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>보고서 AI 모델</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
          대화 보고서를 AI가 요약·작성할 때 사용할 모델을 선택하세요. "사용 안 함" 선택 시 대화를 그대로 마크다운으로 출력합니다.
        </p>
        <div className="relative">
          <select
            value={reportModelId}
            onChange={e => setReportModelId(e.target.value)}
            className="w-full text-[13px] rounded px-2 py-1.5 appearance-none pr-6"
            style={{
              background: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
              outline: 'none',
            }}
          >
            <option value="">사용 안 함 (기본 형식 출력)</option>
            {Object.entries(GROUPED_OPTIONS).map(([provider, models]) => (
              <optgroup key={provider} label={PROVIDER_LABELS[provider as keyof typeof PROVIDER_LABELS] ?? provider}>
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
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            RAG 문서 참조 지침
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
            title="기본값으로 복원"
          >
            기본값 복원
          </button>
        </div>
        <p className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
          볼트 문서를 AI에게 전달할 때 적용되는 참조 원칙입니다. 최신 데이터 우선순위·사실 정확성·인사이트 도출 방식을 설정합니다.
        </p>
        <textarea
          value={ragInstruction ?? ''}
          onChange={e => setRagInstruction(e.target.value)}
          rows={10}
          spellCheck={false}
          style={{
            width: '100%',
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 2,
            padding: '7px 9px',
            fontSize: 13,
            fontFamily: 'ui-monospace, monospace',
            color: 'var(--color-text-primary)',
            resize: 'vertical',
            lineHeight: 1.6,
            outline: 'none',
          }}
          placeholder="예: - 항상 최신 문서를 우선 참조하세요."
        />
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Response instructions */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            AI 응답 지침
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
            title="기본 응답 원칙으로 복원"
          >
            기본값 복원
          </button>
        </div>
        <p className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
          모든 페르소나에 공통 적용되는 응답 형식·태도 지침입니다. 수정하거나 항목을 추가하세요.
        </p>
      {/* Multi-agent RAG toggle */}
      <div className="flex items-center justify-between py-2">
        <div>
          <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Multi-agent RAG
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            연관 문서를 저렴한 Worker 모델로 병렬 요약 후 Chief에게 전달. 응답 품질 향상, 레이턴시 소폭 증가.
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

      {/* Citation mode toggle */}
      <div className="flex items-start justify-between py-2">
        <div>
          <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            인용 모드 (할루시네이션 억제)
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            ON: Worker가 문서 원문을 인용 추출, Chief가 추론 시 <strong>(추론)</strong> 표시. OFF: 기존 요약 방식.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={citationMode}
          onClick={() => setCitationMode(!citationMode)}
          className="shrink-0 ml-4 w-9 h-5 rounded-full transition-colors"
          style={{
            background: citationMode ? 'var(--color-accent)' : 'var(--color-bg-hover)',
            border: '1px solid var(--color-border)',
          }}
        >
          <span
            className="block w-3.5 h-3.5 rounded-full bg-white transition-transform"
            style={{ transform: citationMode ? 'translateX(18px)' : 'translateX(2px)', marginTop: 2 }}
          />
        </button>
      </div>

      {/* Self-Review toggle */}
      <div className="flex items-start justify-between py-2">
        <div>
          <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            2-pass 자기 검토
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            OFF 시 답변 1회 생성만 수행 (LLM 호출 1회 절감). ON 시 품질 검토 후 보완.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={selfReview}
          onClick={() => setSelfReview(!selfReview)}
          className="shrink-0 ml-4 w-9 h-5 rounded-full transition-colors"
          style={{
            background: selfReview ? 'var(--color-accent)' : 'var(--color-bg-hover)',
            border: '1px solid var(--color-border)',
          }}
        >
          <span
            className="block w-3.5 h-3.5 rounded-full bg-white transition-transform"
            style={{ transform: selfReview ? 'translateX(18px)' : 'translateX(2px)', marginTop: 2 }}
          />
        </button>
      </div>

      {/* nAgents slider */}
      <div className="flex items-center justify-between py-2">
        <div>
          <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            서브 에이전트 수: {nAgents}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Multi-agent RAG에서 병렬 분석할 문서 수. 낮을수록 비용↓·속도↑ (기본값 6).
          </p>
        </div>
        <input
          type="range"
          min={1} max={15} step={1}
          value={nAgents}
          onChange={e => setNAgents(Number(e.target.value))}
          className="ml-4 w-24"
          disabled={!multiAgentRAG}
          style={{ accentColor: 'var(--color-accent)' }}
        />
      </div>

      {/* Web Search toggle */}
      <div className="flex items-start justify-between py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div>
          <p className="text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>
            웹 검색 (DuckDuckGo)
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Worker가 볼트 외 최신 정보 필요 여부를 자율 판단해 DuckDuckGo 검색 후 컨텍스트 보강.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={webSearch}
          onClick={() => setWebSearch(!webSearch)}
          className="shrink-0 ml-4 w-9 h-5 rounded-full transition-colors"
          style={{
            background: webSearch ? 'var(--color-accent)' : 'var(--color-bg-hover)',
            border: '1px solid var(--color-border)',
          }}
        >
          <span
            className="block w-3.5 h-3.5 rounded-full bg-white transition-transform"
            style={{ transform: webSearch ? 'translateX(18px)' : 'translateX(2px)', marginTop: 2 }}
          />
        </button>
      </div>

        <textarea
          value={responseInstructions ?? ''}
          onChange={e => setResponseInstructions(e.target.value)}
          rows={8}
          spellCheck={false}
          style={{
            width: '100%',
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 2,
            padding: '7px 9px',
            fontSize: 13,
            fontFamily: 'ui-monospace, monospace',
            color: 'var(--color-text-primary)',
            resize: 'vertical',
            lineHeight: 1.6,
            outline: 'none',
          }}
          placeholder="예: - 답변은 항상 3줄 이내로 요약해주세요."
        />
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Sensitive keywords */}
      <section className="flex flex-col gap-2">
        <div>
          <h3 style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 4 }}>
            민감 키워드
          </h3>
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            질문에 아래 키워드가 포함되면 AI가 해당 주제를 최우선으로 상세하게 답변합니다. 쉼표 또는 줄바꿈으로 구분.
          </p>
        </div>
        <textarea
          value={sensitiveKeywords ?? ''}
          onChange={e => setSensitiveKeywords(e.target.value)}
          rows={4}
          spellCheck={false}
          style={{
            width: '100%',
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 2,
            padding: '7px 9px',
            fontSize: 13,
            fontFamily: 'ui-monospace, monospace',
            color: 'var(--color-text-primary)',
            resize: 'vertical',
            lineHeight: 1.6,
            outline: 'none',
          }}
          placeholder={'예: 캐릭터C, 프로젝트A\n캐릭터 외형\n스킬 시스템'}
        />
      </section>
    </div>
  )
}
