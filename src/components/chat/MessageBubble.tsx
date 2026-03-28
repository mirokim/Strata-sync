import { useMemo, useState, useCallback, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '@/types'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'

interface Props {
  message: ChatMessage
}

function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user'
  const speakerMeta = SPEAKER_CONFIG[message.persona]
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const toggleTools = useCallback(() => setToolsOpen(v => !v), [])

  const renderedContent = useMemo(() => {
    if (isUser) return null
    // 스트리밍 중에는 plain text — ReactMarkdown 파싱 비용 방지
    if (message.streaming) {
      return (
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, wordBreak: 'break-word' }}>
          {message.content}
        </div>
      )
    }
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}
              >
                {children}
              </a>
            )
          },
        }}
      >
        {message.content}
      </ReactMarkdown>
    )
  }, [isUser, message.content, message.streaming])

  if (isUser) {
    return (
      <div
        className="flex justify-end mb-3"
        data-testid={`message-${message.id}`}
        data-role="user"
      >
        <div
          className="max-w-[88%] rounded-lg px-3 py-2 text-sm leading-relaxed"
          style={{
            background: 'var(--chat-user-bg)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--chat-user-border)',
          }}
        >
          {/* Attachment previews for user messages */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {message.attachments.map(att =>
                att.type === 'image' ? (
                  <img
                    key={att.id}
                    src={att.dataUrl}
                    alt={att.name}
                    className="rounded"
                    style={{ maxWidth: 120, maxHeight: 80, objectFit: 'cover' }}
                  />
                ) : (
                  <span
                    key={att.id}
                    className="text-xs px-2 py-0.5 rounded"
                    style={{
                      background: 'var(--color-bg-hover)',
                      color: 'var(--color-text-muted)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    📄 {att.name}
                  </span>
                )
              )}
            </div>
          )}
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex gap-2 mb-3"
      data-testid={`message-${message.id}`}
      data-role="assistant"
      data-persona={message.persona}
      data-streaming={message.streaming ? 'true' : 'false'}
    >
      {/* Persona badge */}
      <div
        className="shrink-0 text-xs px-1.5 rounded self-start mt-1 py-0.5"
        style={{
          background: speakerMeta.darkBg,
          color: speakerMeta.color,
          fontFamily: 'monospace',
          minWidth: 36,
          textAlign: 'center',
        }}
      >
        {speakerMeta.label}
      </div>

      {/* Message content */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {/* 에이전트 처리 과정 (thinking) — 접을 수 있는 섹션 */}
        {message.thinking && (
          <div
            style={{
              borderRadius: 6,
              border: '1px solid rgba(168,85,247,0.25)',
              background: 'rgba(168,85,247,0.05)',
              fontSize: 11,
              overflow: 'hidden',
            }}
          >
            <button
              onClick={() => setThinkingOpen(v => !v)}
              style={{
                width: '100%', textAlign: 'left', padding: '5px 10px',
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'rgba(168,85,247,0.85)', fontWeight: 500,
              }}
            >
              <span style={{ fontSize: 12 }}>💭</span>
              <span>에이전트 처리 과정</span>
              <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.7 }}>
                {thinkingOpen ? '▲' : '▼'}
              </span>
            </button>
            {thinkingOpen && (
              <div style={{ padding: '0 10px 8px', color: 'rgba(168,85,247,0.8)', whiteSpace: 'pre-wrap', lineHeight: 1.6, maxHeight: 320, overflowY: 'auto' }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.thinking}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* 도구 호출 카드 (접을 수 있는 섹션) */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div
            style={{
              borderRadius: 6,
              border: '1px solid rgba(59,130,246,0.25)',
              background: 'rgba(59,130,246,0.05)',
              fontSize: 11,
              overflow: 'hidden',
            }}
          >
            <button
              onClick={toggleTools}
              style={{
                width: '100%', textAlign: 'left', padding: '5px 10px',
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'rgba(59,130,246,0.85)', fontWeight: 500,
              }}
            >
              <span style={{ fontSize: 12 }}>🔧</span>
              <span>도구 {message.toolCalls.length}회 사용</span>
              <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.7 }}>
                {toolsOpen ? '▲' : '▼'}
              </span>
            </button>
            {toolsOpen && (
              <div style={{ padding: '0 10px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {message.toolCalls.map((tc, i) => (
                  <div
                    key={i}
                    style={{
                      borderRadius: 4,
                      border: '1px solid rgba(59,130,246,0.2)',
                      background: 'rgba(59,130,246,0.06)',
                      padding: '4px 8px',
                    }}
                  >
                    <div style={{ color: 'rgba(59,130,246,0.9)', fontWeight: 600, fontFamily: 'monospace', marginBottom: 2 }}>
                      {tc.name}
                    </div>
                    <div style={{ color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 120, overflowY: 'auto' }}>
                      {typeof tc.result === 'string' ? tc.result.slice(0, 500) : JSON.stringify(tc.result)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 메인 응답 */}
        <div
          className="rounded-lg px-3 py-2 text-sm leading-relaxed prose-vault prose-chat"
          style={{
            background: `${speakerMeta.color}1a`,
            color: 'var(--color-text-primary)',
            border: `1px solid ${speakerMeta.color}33`,
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
          }}
        >
        {message.streaming && message.content === '' ? (
          /* Dots typing indicator while waiting for first token */
          <span className="inline-flex gap-1 items-center" aria-label="입력 중">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{
                  background: speakerMeta.color,
                  animation: `pulse 1s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
          </span>
        ) : (
          <>
            {renderedContent}
            {/* Blinking block cursor while streaming */}
            {message.streaming && (
              <span
                className="streaming-cursor"
                style={{ background: speakerMeta.color }}
                aria-hidden="true"
              />
            )}
          </>
        )}
        </div>
      </div>
    </div>
  )
}

export default memo(MessageBubble)
