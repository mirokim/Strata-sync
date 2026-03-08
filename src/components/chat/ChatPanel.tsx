import { useState } from 'react'
import { FileText, Pin } from 'lucide-react'
import PersonaChips from './PersonaChips'
import MessageList from './MessageList'
import QuickQuestions from './QuickQuestions'
import ChatInput from './ChatInput'
import { useDebateStore } from '@/stores/debateStore'
import { DebateSetup } from './debate/DebateSetup'
import { DebateControlBar } from './debate/DebateControlBar'
import { DebateThread } from './debate/DebateThread'
import { DebateUserInput } from './debate/DebateUserInput'
import { useSettingsStore } from '@/stores/settingsStore'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { useMemoryStore } from '@/stores/memoryStore'

export default function ChatPanel() {
  const [debateMode, setDebateMode] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const debateStatus = useDebateStore((s) => s.status)
  const { setSettingsPanelOpen } = useSettingsStore()
  const messages = useChatStore((s) => s.messages)
  const { openInEditor } = useUIStore()
  const { memoryText, setMemoryText, clearMemory } = useMemoryStore()

  const openDebateSettings = () => {
    setSettingsPanelOpen(true)
  }

  return (
    <div className="flex flex-col h-full" data-testid="chat-panel">
      {/* Header: persona selector or debate mode label */}
      <div
        className="shrink-0 px-4 py-3"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            {debateMode && (
              <div
                className="text-xs mb-2"
                style={{ color: 'var(--color-text-muted)', fontFamily: 'monospace' }}
              >
                ⚔️ AI Debate
              </div>
            )}
            {!debateMode && <PersonaChips />}
          </div>

          {/* Memory / Summary / Report buttons */}
          {!debateMode && (
            <div className="shrink-0 flex items-center gap-1 ml-2">
              <button
                onClick={() => setMemoryOpen(v => !v)}
                className="p-1.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                style={{ color: memoryText.trim() ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}
                title="AI Memory Note"
                aria-label="AI Memory Note"
              >
                <Pin size={13} />
              </button>
              {messages.length > 0 && (
                <button
                  onClick={() => openInEditor('report:latest')}
                  className="p-1.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                  style={{ color: 'var(--color-text-secondary)' }}
                  title="View conversation report"
                  aria-label="View conversation report"
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
          {/* AI Memory panel */}
          {memoryOpen && (
            <div
              className="shrink-0 px-4 py-3 flex flex-col gap-2"
              style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  📌 AI Memory Note — persists even after closing the app
                </span>
                {memoryText.trim() && (
                  <button
                    onClick={clearMemory}
                    className="text-xs px-2 py-0.5 rounded hover:bg-[var(--color-bg-hover)]"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    Clear
                  </button>
                )}
              </div>
              <textarea
                value={memoryText}
                onChange={e => setMemoryText(e.target.value)}
                placeholder="Enter anything you want the AI to remember. It will be included automatically in all AI conversations."
                rows={5}
                className="w-full resize-none rounded p-2 text-xs outline-none"
                style={{
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  fontFamily: 'monospace',
                }}
              />
            </div>
          )}

          {/* Normal chat */}
          <MessageList />

          <div
            className="shrink-0 px-4 py-2"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            <QuickQuestions />
          </div>

          <ChatInput debateMode={debateMode} onToggleDebate={() => setDebateMode(v => !v)} />
        </>
      )}
    </div>
  )
}
