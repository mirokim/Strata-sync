import { useState } from 'react'
import { FileText } from 'lucide-react'
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

export default function ChatPanel() {
  const [debateMode, setDebateMode] = useState(false)
  const debateStatus = useDebateStore((s) => s.status)
  const { setSettingsPanelOpen } = useSettingsStore()
  const messages = useChatStore((s) => s.messages)
  const { openInEditor } = useUIStore()

  const openDebateSettings = () => {
    setSettingsPanelOpen(true)
  }

  return (
    <div className="flex flex-col h-full" data-testid="chat-panel">
      {/* Header */}
      <div
        className="shrink-0 px-4 py-3"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            {debateMode && (
              <div
                className="text-xs"
                style={{ color: 'var(--color-text-muted)', fontFamily: 'monospace' }}
              >
                ⚔️ AI Debate
              </div>
            )}
          </div>

          {!debateMode && messages.length > 0 && (
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
