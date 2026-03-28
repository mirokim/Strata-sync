import { useState, useEffect } from 'react'
import { Eye, EyeOff, RefreshCw, CheckCircle2, Loader2, AlertCircle, Trash2 } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { vectorEmbedIndex } from '@/lib/vectorEmbedIndex'
import { invalidateVectorEmbedCache } from '@/lib/vectorEmbedCache'
import { useVaultStore } from '@/stores/vaultStore'
import { buildFingerprint } from '@/lib/tfidfCache'

export default function VectorEmbedTab() {
  const { apiKeys, setApiKey } = useSettingsStore()
  const { loadedDocuments, vaultPath } = useVaultStore()
  const [showKey, setShowKey] = useState(false)
  const [status, setStatus] = useState({
    isBuilt: vectorEmbedIndex.isBuilt,
    isBuilding: vectorEmbedIndex.isBuilding,
    progress: vectorEmbedIndex.progress,
    size: vectorEmbedIndex.size,
    lastError: vectorEmbedIndex.lastError,
  })

  // 상태 폴링 — 빌드 중이면 500ms, 완료 후에도 1회 갱신
  useEffect(() => {
    const tick = () => setStatus({
      isBuilt: vectorEmbedIndex.isBuilt,
      isBuilding: vectorEmbedIndex.isBuilding,
      progress: vectorEmbedIndex.progress,
      size: vectorEmbedIndex.size,
      lastError: vectorEmbedIndex.lastError,
    })
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [])

  const geminiKey = apiKeys['gemini'] ?? ''
  const hasKey = Boolean(geminiKey)
  const docCount = loadedDocuments?.length ?? 0

  async function handleBuild() {
    if (!hasKey || status.isBuilding || docCount === 0) return
    const path = vaultPath ?? ''
    const fingerprint = buildFingerprint(loadedDocuments ?? [])
    await invalidateVectorEmbedCache(path)  // 캐시 삭제 후 새로 빌드
    vectorEmbedIndex.reset()
    vectorEmbedIndex.buildInBackground(loadedDocuments ?? [], geminiKey, path, fingerprint)
      .catch(() => { /* 에러는 logger에서 처리 */ })
  }

  async function handleReset() {
    if (status.isBuilding) return
    await invalidateVectorEmbedCache(vaultPath ?? '')
    vectorEmbedIndex.reset()
  }

  const hasError = Boolean(status.lastError) && !status.isBuilt && !status.isBuilding
  const statusIcon = status.isBuilding
    ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
    : status.isBuilt
      ? <CheckCircle2 size={14} style={{ color: '#4caf50' }} />
      : hasError
        ? <AlertCircle size={14} style={{ color: '#ef4444' }} />
        : <AlertCircle size={14} style={{ color: 'var(--color-text-muted)' }} />

  const statusText = status.isBuilding
    ? `빌드 중… ${status.progress}%`
    : status.isBuilt
      ? `준비됨 — ${status.size}개 문서 인덱싱됨`
      : hasError
        ? `빌드 실패`
        : hasKey ? '인덱스 없음 — 볼트 로드 시 자동 빌드' : 'Gemini API 키 필요'

  return (
    <div className="flex flex-col gap-5">

      <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
        Google Gemini의 <strong>gemini-embedding-001</strong> 모델로 문서를 벡터화합니다.
        BM25 키워드 검색 결과를 의미 유사도로 reranking하여 추상적 쿼리의 정확도를 높입니다.
        <span style={{ color: '#4caf50' }}> 무료 (API 쿼터 내)</span>
      </p>

      {/* ── 상태 표시 ── */}
      <section>
        <h3 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          인덱스 상태
        </h3>
        <div
          className="rounded-lg px-4 py-3 flex items-center justify-between gap-3"
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
        >
          <div className="flex items-center gap-2">
            {statusIcon}
            <span className="text-[13px]" style={{ color: 'var(--color-text-primary)' }}>
              {statusText}
            </span>
          </div>
          {status.isBuilding && (
            <div
              className="flex-1 max-w-32 h-1.5 rounded-full overflow-hidden"
              style={{ background: 'var(--color-border)' }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${status.progress}%`, background: 'var(--color-accent)' }}
              />
            </div>
          )}
        </div>
        {hasError && (
          <p className="text-[11px] mt-1.5 px-1" style={{ color: '#ef4444' }}>
            {status.lastError}
          </p>
        )}
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
          볼트 로드 시 자동으로 백그라운드 빌드됩니다. 이미 빌드된 경우 IndexedDB 캐시에서 즉시 복원합니다.
        </p>
      </section>

      {/* ── Gemini API 키 ── */}
      <section>
        <h3 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Gemini API 키
        </h3>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={geminiKey}
            onChange={e => setApiKey('gemini', e.target.value.trim())}
            placeholder="AIza..."
            className="w-full text-[13px] rounded px-3 py-2 pr-9 font-mono"
            style={{
              background: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
              outline: 'none',
            }}
            autoComplete="off"
          />
          <button
            onClick={() => setShowKey(v => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5"
            style={{ color: 'var(--color-text-muted)' }}
            tabIndex={-1}
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
          Google AI Studio에서 발급 — AI 설정 탭의 Gemini 키와 동일합니다.
        </p>
      </section>

      {/* ── 수동 재빌드 ── */}
      <section>
        <h3 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          수동 재빌드
        </h3>
        <div className="flex items-center gap-3">
          <button
            onClick={handleBuild}
            disabled={!hasKey || status.isBuilding || docCount === 0}
            className="flex items-center gap-2 px-3 py-2 rounded text-[13px] transition-opacity"
            style={{
              background: 'var(--color-accent)',
              color: '#fff',
              opacity: (!hasKey || status.isBuilding || docCount === 0) ? 0.4 : 1,
              cursor: (!hasKey || status.isBuilding || docCount === 0) ? 'not-allowed' : 'pointer',
            }}
          >
            {status.isBuilding
              ? <Loader2 size={13} className="animate-spin" />
              : <RefreshCw size={13} />}
            {status.isBuilding ? `빌드 중 (${status.progress}%)` : '지금 빌드'}
          </button>
          <button
            onClick={handleReset}
            disabled={status.isBuilding}
            className="flex items-center gap-2 px-3 py-2 rounded text-[13px] transition-opacity"
            style={{
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              opacity: status.isBuilding ? 0.4 : 1,
              cursor: status.isBuilding ? 'not-allowed' : 'pointer',
            }}
          >
            <Trash2 size={13} />
            초기화
          </button>
          <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
            {docCount > 0 ? `${docCount}개 문서` : '볼트 로드 후 사용 가능'}
          </span>
        </div>
        {!hasKey && (
          <p className="text-[11px] mt-2" style={{ color: '#f59e0b' }}>
            ⚠ Gemini API 키를 먼저 입력하세요.
          </p>
        )}
      </section>

      {/* ── 동작 방식 ── */}
      <section>
        <h3 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          동작 방식
        </h3>
        <div
          className="rounded-lg px-4 py-3 text-[12px] flex flex-col gap-1.5"
          style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', lineHeight: 1.6 }}
        >
          <div>① <strong style={{ color: 'var(--color-text-primary)' }}>BM25</strong> — 쿼리 키워드로 상위 후보 50개 추출 (기존 방식)</div>
          <div>② <strong style={{ color: 'var(--color-text-primary)' }}>쿼리 임베딩</strong> — 쿼리를 768차원 벡터로 변환 (API 호출 1회)</div>
          <div>③ <strong style={{ color: 'var(--color-text-primary)' }}>Reranking</strong> — BM25 40% + 의미 유사도 60%로 최종 순위 결정</div>
          <div className="mt-1" style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
            문서 임베딩은 IndexedDB에 캐시 — 볼트가 변경될 때만 재생성됩니다.
          </div>
        </div>
      </section>

    </div>
  )
}
