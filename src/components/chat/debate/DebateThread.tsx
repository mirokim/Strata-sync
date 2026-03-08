/**
 * DebateThread — Message list with typing indicator.
 * Adapted from Onion_flow's DebateThread.tsx.
 */
import { useEffect, useRef, useState } from 'react'
import { FileText, MessageCircle } from 'lucide-react'
import { useDebateStore } from '@/stores/debateStore'
import { DEBATE_PROVIDER_LABELS, DEBATE_PROVIDER_COLORS } from '@/services/debateRoles'
import type { DiscussionMessage, ReferenceFile } from '@/types'

function TypingIndicator({ provider }: { provider: string }) {
  const color = DEBATE_PROVIDER_COLORS[provider] || '#888'
  const label = DEBATE_PROVIDER_LABELS[provider] || provider

  return (
    <div className="flex gap-3">
      <div className="w-0.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <div className="py-2">
        <span className="text-[11px] font-semibold tracking-wide" style={{ color }}>
          {label}
        </span>
        <div className="flex items-center gap-1.5 mt-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-text-muted)', animation: 'pulse 1.2s infinite' }} />
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-text-muted)', animation: 'pulse 1.2s infinite', animationDelay: '0.2s' }} />
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-text-muted)', animation: 'pulse 1.2s infinite', animationDelay: '0.4s' }} />
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: DiscussionMessage }) {
  const isUser = message.provider === 'user'
  const isError = !!message.error
  const isJudgeEval = message.messageType === 'judge-evaluation'
  const color = isUser
    ? '#fbbf24'
    : (DEBATE_PROVIDER_COLORS[message.provider] || '#888')
  const label = isUser
    ? 'You'
    : (DEBATE_PROVIDER_LABELS[message.provider] || message.provider)
  const [expandedImage, setExpandedImage] = useState<string | null>(null)

  return (
    <>
      <div
        className="flex gap-3"
        style={{
          opacity: isError ? 0.5 : 1,
          ...(isJudgeEval
            ? {
                background: 'rgba(255,152,0,0.05)',
                borderRadius: 8,
                padding: '10px',
                border: '1px solid rgba(255,152,0,0.2)',
              }
            : {}),
        }}
      >
        {/* Color bar */}
        <div
          className="shrink-0 rounded-full"
          style={{
            width: isJudgeEval ? 4 : 2,
            backgroundColor: isJudgeEval ? '#f59e0b' : color,
          }}
        />

        {/* Content */}
        <div className="min-w-0 flex-1 py-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="text-[11px] font-semibold tracking-wide"
              style={{ color: isJudgeEval ? '#f59e0b' : color }}
            >
              {label}
            </span>
            {message.roleName && !isJudgeEval && (
              <span
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(82,156,202,0.1)', color: 'var(--color-accent)' }}
              >
                {message.roleName}
              </span>
            )}
            {isJudgeEval && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(255,152,0,0.15)', color: '#ff9800' }}
              >
                Judge
              </span>
            )}
            <span
              className="text-[9px] font-medium px-1.5 py-0.5 rounded"
              style={{ background: 'var(--color-bg-surface)', color: 'var(--color-text-muted)' }}
            >
              R{message.round}
            </span>
            {isError && (
              <span
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(244,67,54,0.1)', color: '#f44336' }}
              >
                Error
              </span>
            )}
          </div>

          {/* Attached files */}
          {message.files && message.files.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {message.files.map((file: ReferenceFile) => (
                <div key={file.id} className="shrink-0">
                  {file.mimeType.startsWith('image/') ? (
                    <img
                      src={file.dataUrl}
                      alt={file.filename}
                      className="max-w-[180px] max-h-[130px] object-cover rounded-lg cursor-pointer hover:opacity-80 transition"
                      style={{ border: '1px solid var(--color-border)' }}
                      onClick={() => setExpandedImage(file.dataUrl)}
                    />
                  ) : (
                    <div
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                      style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                      <span
                        className="text-xs truncate max-w-[130px]"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        {file.filename}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div
            className="text-[13px] whitespace-pre-wrap leading-[1.7]"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {message.content}
          </div>
        </div>
      </div>

      {/* Image lightbox */}
      {expandedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 cursor-pointer"
          style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
          onClick={() => setExpandedImage(null)}
        >
          <img
            src={expandedImage}
            alt=""
            className="max-w-full max-h-full object-contain rounded-lg"
            style={{ boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}
          />
        </div>
      )}
    </>
  )
}

export function DebateThread() {
  const messages = useDebateStore((s) => s.messages)
  const loadingProvider = useDebateStore((s) => s.loadingProvider)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [messages.length, loadingProvider])

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      {messages.length === 0 && !loadingProvider && (
        <div
          className="flex flex-col items-center justify-center h-full gap-3"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--color-bg-surface)' }}
          >
            <MessageCircle className="w-5 h-5" />
          </div>
          <p className="text-xs">Conversation will appear here once the debate starts</p>
        </div>
      )}

      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {loadingProvider && <TypingIndicator provider={loadingProvider} />}
    </div>
  )
}
