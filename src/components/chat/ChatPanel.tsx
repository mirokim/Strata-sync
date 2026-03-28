import { useState, useRef } from 'react'
import { FileText, NotebookPen } from 'lucide-react'
import PersonaChips from './PersonaChips'
import MessageList from './MessageList'
import QuickQuestions from './QuickQuestions'
import ChatInput from './ChatInput'
import { useDebateStore } from '@/stores/debateStore'
import { DebateSetup } from './debate/DebateSetup'
import { DebateControlBar } from './debate/DebateControlBar'
import { DebateThread } from './debate/DebateThread'
import { DebateUserInput } from './debate/DebateUserInput'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { useMemoryStore } from '@/stores/memoryStore'
import { summarizeConversation } from '@/services/llmClient'

export default function ChatPanel() {
  const [debateMode, setDebateMode] = useState(false)
  const [isSummarizing, setIsSummarizing] = useState(false)
  const debateStatus = useDebateStore((s) => s.status)
  const messages = useChatStore((s) => s.messages)
  const openInEditor = useUIStore(s => s.openInEditor)
  const setCenterTab = useUIStore(s => s.setCenterTab)
  const { memoryText, appendToMemory } = useMemoryStore()
  const summaryChunksRef = useRef<string[]>([])
  const [summarizeError, setSummarizeError] = useState<string | null>(null)

  const openDebateSettings = () => {
    setCenterTab('settings')
  }

  const handleSummarize = async () => {
    if (isSummarizing || messages.length === 0) return
    setIsSummarizing(true)
    setSummarizeError(null)
    summaryChunksRef.current = []
    try {
      await summarizeConversation(messages, (chunk) => {
        summaryChunksRef.current.push(chunk)
      })
      const result = summaryChunksRef.current.join('').trim()
      if (result) appendToMemory(result)
    } catch (e) {
      setSummarizeError('요약 실패: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setIsSummarizing(false)
    }
  }

  return (
    <div className="flex flex-col h-full" data-testid="chat-panel">
      {/* Header: persona selector or debate mode label */}
      <div
        className="shrink-0 px-4"
        style={{ borderBottom: '1px solid var(--color-border)', height: 36, display: 'flex', alignItems: 'center' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            {debateMode && (
              <div
                className="text-xs mb-2"
                style={{ color: 'var(--color-text-muted)', fontFamily: 'monospace' }}
              >
                ⚔️ AI 토론
              </div>
            )}
            {!debateMode && <PersonaChips />}
          </div>

          {/* 요약 저장 / 보고서 버튼 */}
          {!debateMode && (
            <div className="shrink-0 flex items-center gap-1 ml-2">
              {messages.length > 0 && (
                <button
                  onClick={handleSummarize}
                  disabled={isSummarizing}
                  className="p-1.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                  style={{ color: summarizeError ? 'var(--color-error)' : memoryText.trim() ? 'var(--color-accent)' : 'var(--color-text-secondary)', opacity: isSummarizing ? 0.5 : 1 }}
                  title={isSummarizing ? '요약 중...' : summarizeError ?? '대화 요약 → 기억에 저장'}
                  aria-label="대화 요약 저장"
                >
                  <NotebookPen size={13} />
                </button>
              )}
              {messages.length > 0 && (
                <button
                  onClick={() => openInEditor('report:latest')}
                  className="p-1.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                  style={{ color: 'var(--color-text-secondary)' }}
                  title="대화 보고서 보기"
                  aria-label="대화 보고서 보기"
                >
                  <FileText size={13} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main content area */}
      {debateMode ? (
        <>
          {debateStatus === 'idle' ? (
            <DebateSetup
              onBack={() => setDebateMode(false)}
              onOpenSettings={openDebateSettings}
            />
          ) : (
            <>
              <DebateControlBar />
              <DebateThread />
              <DebateUserInput />
            </>
          )}
        </>
      ) : (
        <>
          {/* Normal chat */}
          <MessageList />

          <div
            className="shrink-0"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            <div className="px-4 pt-2">
              <QuickQuestions />
            </div>
            <ChatInput debateMode={debateMode} onToggleDebate={() => setDebateMode(v => !v)} />
          </div>
        </>
      )}
    </div>
  )
}
