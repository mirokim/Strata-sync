import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEditAgentStore } from '@/stores/editAgentStore'
import { sendEditAgentChatMessage } from '@/services/editAgentRunner'
import { Send, ChevronDown, ChevronRight } from 'lucide-react'

// Short display label for each tool name
const TOOL_LABEL: Record<string, string> = {
  run_python_tool: 'python',
  web_search:      'search',
  gstack:          'browser',
  read_file:       'read',
  write_file:      'write',
  list_directory:  'ls',
  rename_file:     'rename',
  delete_file:     'rm',
  create_folder:   'mkdir',
  move_file:       'mv',
  pdf_import:      'pdf',
}

// Accent color per tool — sourced from CSS variables (defined in index.css)
const TOOL_COLOR: Record<string, string> = {
  run_python_tool:   'var(--ea-tool-python)',
  web_search:        'var(--ea-tool-search)',
  gstack:            'var(--ea-tool-browser)',
  write_file:        'var(--ea-tool-write)',
  delete_file:       'var(--ea-tool-delete)',
  pdf_import:        'var(--ea-tool-pdf)',
}
const toolColor = (name: string) => TOOL_COLOR[name] ?? 'var(--ea-tool-default)'

const MONO = 'var(--ea-font-mono)'

export default function EditAgentChat() {
  const messages            = useEditAgentStore(s => s.messages)
  const streamingId         = useEditAgentStore(s => s.streamingMessageId)
  const toggleToolCollapsed = useEditAgentStore(s => s.toggleToolCollapsed)
  const [input, setInput]   = useState('')
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow textarea (max 5 lines)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [input])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setSending(true)
    try { await sendEditAgentChatMessage(text) }
    finally { setSending(false) }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const canSend = !!input.trim() && !sending
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--color-bg-secondary)',
    }}>

      {/* Message list */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto',
        padding: '10px 12px',
        display: 'flex', flexDirection: 'column', gap: 3,
      }}>
        {messages.length === 0 && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: 80, textAlign: 'center',
            fontSize: 12, color: 'var(--color-text-muted)',
            lineHeight: 1.6,
          }}>
            Request improvements to your vault documents
          </div>
        )}

        {messages.map((msg, i, arr) => {
          const prevRole = i > 0 ? arr[i - 1].role : null
          const isGrouped = prevRole === msg.role

          // Tool call card
          if (msg.role === 'tool') {
            const collapsed = msg.collapsed !== false
            const isGroup = msg.toolGroup && msg.toolGroup.length > 1

            // Header label: grouped -> "tool1 . tool2 . tool3", single -> label
            const headerLabel = isGroup
              ? msg.toolGroup!.map(t => TOOL_LABEL[t.name] ?? t.name).join(' · ')
              : (TOOL_LABEL[msg.toolName ?? ''] ?? (msg.toolName ?? 'tool'))

            const headerColor = isGroup
              ? 'var(--ea-tool-default)'
              : toolColor(msg.toolName ?? '')

            return (
              <div key={msg.id} style={{ marginTop: isGrouped ? 2 : 6 }}>
                <button
                  onClick={() => toggleToolCollapsed(msg.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    width: '100%', padding: '4px 8px',
                    background: 'var(--color-bg-surface)',
                    border: '1px solid var(--color-border)',
                    borderBottom: collapsed ? '1px solid var(--color-border)' : 'none',
                    borderRadius: collapsed ? 'var(--ea-radius)' : 'var(--ea-radius) var(--ea-radius) 0 0',
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-hover)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-surface)' }}
                >
                  <span style={{ color: 'var(--color-text-muted)', display: 'flex', flexShrink: 0 }}>
                    {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                  </span>
                  <span style={{
                    fontFamily: MONO,
                    fontSize: 10, fontWeight: 700,
                    color: headerColor, letterSpacing: '0.06em',
                  }}>
                    {headerLabel}
                  </span>
                  {isGroup && (
                    <span style={{
                      marginLeft: 'auto', fontFamily: MONO, fontSize: 9,
                      color: 'var(--color-text-muted)',
                    }}>
                      x{msg.toolGroup!.length}
                    </span>
                  )}
                </button>

                {!collapsed && (
                  isGroup ? (
                    <div style={{
                      margin: 0,
                      background: 'var(--color-bg-primary)',
                      border: '1px solid var(--color-border)',
                      borderTop: 'none',
                      borderRadius: '0 0 var(--ea-radius) var(--ea-radius)',
                      maxHeight: 320, overflowY: 'auto',
                    }}>
                      {msg.toolGroup!.map((t, idx) => (
                        <div key={idx} style={{
                          borderTop: idx > 0 ? '1px solid var(--color-border)' : 'none',
                          padding: '6px 10px',
                        }}>
                          <div style={{
                            fontFamily: MONO, fontSize: 10, fontWeight: 700,
                            color: toolColor(t.name), marginBottom: 4,
                          }}>
                            {TOOL_LABEL[t.name] ?? t.name}
                          </div>
                          <pre style={{
                            margin: 0,
                            fontFamily: MONO, fontSize: 10,
                            color: 'var(--color-text-secondary)',
                            lineHeight: 1.6,
                            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                          }}>
                            {JSON.stringify(t.input, null, 2)}
                            {'\n\n---\n'}
                            {t.result}
                          </pre>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <pre style={{
                      margin: 0, padding: '8px 10px',
                      background: 'var(--color-bg-primary)',
                      border: '1px solid var(--color-border)',
                      borderTop: 'none',
                      borderRadius: '0 0 var(--ea-radius) var(--ea-radius)',
                      fontFamily: MONO, fontSize: 10,
                      color: 'var(--color-text-secondary)',
                      lineHeight: 1.6,
                      maxHeight: 240, overflowY: 'auto',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    }}>
                      {msg.content}
                    </pre>
                  )
                )}
              </div>
            )
          }

          // User bubble
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="flex justify-end mb-3">
                <div
                  className="max-w-[88%] rounded-lg px-3 py-2 text-sm leading-relaxed"
                  style={{
                    background: 'var(--chat-user-bg)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--chat-user-border)',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}
                >
                  {msg.content}
                </div>
              </div>
            )
          }

          // System notice
          if (msg.role === 'system') {
            return (
              <div key={msg.id} style={{
                display: 'flex', justifyContent: 'center',
                marginTop: 6, marginBottom: 2,
              }}>
                <span style={{
                  fontFamily: MONO, fontSize: 10,
                  color: 'var(--color-text-muted)',
                  padding: '2px 8px',
                  background: 'var(--color-bg-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 4,
                }}>
                  {msg.content}
                </span>
              </div>
            )
          }

          // Agent bubble
          return (
            <div key={msg.id} className="flex mb-3">
              <div
                className="max-w-[88%] rounded-lg px-3 py-2 text-sm leading-relaxed prose-vault prose-chat"
                style={{
                  background: 'var(--chat-agent-bg)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--chat-agent-border)',
                  overflowWrap: 'break-word', wordBreak: 'break-word',
                }}
              >
                {msg.content
                  ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  : (msg.id === streamingId ? null : '...')
                }
                {msg.id === streamingId && (
                  <span style={{
                    display: 'inline-block', width: 7, height: 13,
                    background: 'var(--color-text-secondary)',
                    marginLeft: 2, borderRadius: 1,
                    verticalAlign: 'text-bottom',
                    animation: 'ea-cur 0.9s step-end infinite',
                  }} />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Input */}
      <div style={{
        padding: '12px', flexShrink: 0,
        borderTop: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'stretch', gap: 8,
      }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          style={{
            flex: 1, resize: 'none', overflow: 'hidden',
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
            borderRadius: 3, outline: 'none',
            padding: '8px 12px',
            fontSize: 14, lineHeight: 1.5, fontFamily: 'inherit',
            minHeight: 64,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 8, borderRadius: 3, flexShrink: 0,
            border: '1px solid var(--color-border)',
            background: canSend ? 'var(--color-accent)' : 'var(--color-bg-secondary)',
            color: canSend ? '#fff' : 'var(--color-text-muted)',
            cursor: canSend ? 'pointer' : 'not-allowed',
            transition: 'background 0.12s, color 0.12s',
          }}
        >
          <Send size={14} />
        </button>
      </div>

      <style>{`
        @keyframes ea-cur { 50% { opacity: 0; } }
      `}</style>
    </div>
  )
}
