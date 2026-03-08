import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '@/types'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'

interface Props {
  message: ChatMessage
}

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user'
  const speakerMeta = SPEAKER_CONFIG[message.persona]

  const renderedContent = useMemo(() => {
    if (isUser) return null
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
  }, [isUser, message.content])

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
            background: 'var(--color-bg-surface)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
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
      <div
        className="flex-1 min-w-0 rounded-lg px-3 py-2 text-sm leading-relaxed prose-vault prose-chat"
        style={{
          background: `${speakerMeta.color}1a`, // 10% opacity
          color: 'var(--color-text-primary)',
          border: `1px solid ${speakerMeta.color}33`, // 20% opacity
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
        }}
      >
        {message.streaming && message.content === '' ? (
          /* Dots typing indicator while waiting for first token */
          <span className="inline-flex gap-1 items-center" aria-label="typing">
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
                className="inline-block ml-0.5 align-middle"
                style={{
                  width: '0.55em',
                  height: '1em',
                  background: speakerMeta.color,
                  animation: 'blink 1s step-end infinite',
                  opacity: 0.8,
                }}
                aria-hidden="true"
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
