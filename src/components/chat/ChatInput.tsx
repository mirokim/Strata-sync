import { useState, useRef, useMemo } from 'react'
import { Send, Paperclip, Swords, X } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useGraphStore } from '@/stores/graphStore'
import { useVaultStore } from '@/stores/vaultStore'
import { generateId } from '@/lib/utils'
import type { Attachment } from '@/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

// ── File → Attachment converter ───────────────────────────────────────────────

async function fileToAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 10MB.`)
  }

  const id = generateId()
  const isImage = file.type.startsWith('image/')

  return new Promise<Attachment>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`))

    if (isImage) {
      // Read as base64 data URL for vision API
      reader.onload = () =>
        resolve({
          id,
          name: file.name,
          type: 'image',
          mimeType: file.type,
          dataUrl: reader.result as string,
          size: file.size,
        })
      reader.readAsDataURL(file)
    } else {
      // Read as raw UTF-8 text for context injection
      reader.onload = () =>
        resolve({
          id,
          name: file.name,
          type: 'text',
          mimeType: file.type || 'text/plain',
          dataUrl: reader.result as string,
          size: file.size,
        })
      reader.readAsText(file, 'utf-8')
    }
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ChatInputProps {
  debateMode?: boolean
  onToggleDebate?: () => void
}

export default function ChatInput({ debateMode, onToggleDebate }: ChatInputProps) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const { sendMessage, isLoading } = useChatStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Detect imageRefs of the selected document — for auto image attachment
  const selectedNodeId = useGraphStore(s => s.selectedNodeId)
  const loadedDocuments = useVaultStore(s => s.loadedDocuments)
  const imagePathRegistry = useVaultStore(s => s.imagePathRegistry)
  const imageDataCache = useVaultStore(s => s.imageDataCache)

  const selectedDocImageRefs = useMemo(() => {
    if (!selectedNodeId || !loadedDocuments || !imagePathRegistry) return []
    const doc = loadedDocuments.find(d => d.id === selectedNodeId)
    if (!doc?.imageRefs?.length) return []
    // Only return images that are actually in the registry
    return doc.imageRefs.filter(ref => !!imagePathRegistry[ref])
  }, [selectedNodeId, loadedDocuments, imagePathRegistry])

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !isLoading

  const handleSend = async () => {
    if (!canSend) return
    const currentText = text.trim()

    // Auto-load vault images (cache first, IPC fallback on cache miss)
    const autoAttachments: Attachment[] = []
    if (selectedDocImageRefs.length > 0) {
      for (const ref of selectedDocImageRefs) {
        try {
          // 1. Immediate lookup from pre-indexed cache
          let dataUrl = imageDataCache[ref]
          // 2. Cache miss: on-demand load via IPC
          if (!dataUrl && window.vaultAPI?.readImage) {
            const entry = imagePathRegistry?.[ref]
            if (entry) dataUrl = (await window.vaultAPI.readImage(entry.absolutePath)) ?? ''
          }
          if (!dataUrl) continue
          const mimeType = dataUrl.split(';')[0]?.split(':')[1] ?? 'image/png'
          autoAttachments.push({
            id: `vault-img-${ref}`,
            name: ref,
            type: 'image',
            mimeType,
            dataUrl,
            size: 0,
          })
        } catch {
          // Ignore individual image load failures
        }
      }
    }

    const combined = [...autoAttachments, ...attachments]
    const currentAttachments = combined.length > 0 ? combined : undefined
    setText('')
    setAttachments([])
    await sendMessage(currentText, currentAttachments)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFilesSelected = async (files: FileList) => {
    setFileError(null)
    const newAttachments: Attachment[] = []
    const errors: string[] = []
    for (const file of Array.from(files)) {
      try {
        const att = await fileToAttachment(file)
        newAttachments.push(att)
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `${file.name}: read failed`)
      }
    }
    if (errors.length > 0) {
      setFileError(errors.join(', '))
      setTimeout(() => setFileError(null), 5000)
    }
    if (newAttachments.length > 0) {
      setAttachments(prev => [...prev, ...newAttachments])
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id))
  }

  return (
    <div
      className="shrink-0 flex flex-col px-4 py-3 gap-2"
      style={{ borderTop: '1px solid var(--color-border)' }}
      data-testid="chat-input-container"
    >
      {/* Attachment preview chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map(att => (
            <div
              key={att.id}
              className="flex items-center gap-1.5 rounded-lg overflow-hidden text-xs"
              style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                maxWidth: 180,
              }}
            >
              {att.type === 'image' ? (
                <img
                  src={att.dataUrl}
                  alt={att.name}
                  className="w-8 h-8 object-cover shrink-0"
                />
              ) : (
                <span className="px-1.5 shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                  📄
                </span>
              )}
              <span
                className="truncate py-1"
                style={{ color: 'var(--color-text-secondary)', maxWidth: 100 }}
              >
                {att.name}
              </span>
              <button
                onClick={() => removeAttachment(att.id)}
                className="flex items-center justify-center p-1 mr-0.5 shrink-0 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                style={{ color: 'var(--color-text-muted)' }}
                aria-label={`Remove attachment: ${att.name}`}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Vault image auto-attach badge */}
      {selectedDocImageRefs.length > 0 && (
        <div
          className="flex items-center gap-1.5 text-xs px-2 py-1 rounded"
          style={{ color: 'var(--color-text-muted)', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)' }}
        >
          <span>🖼️</span>
          <span>{selectedDocImageRefs.length} image{selectedDocImageRefs.length !== 1 ? 's' : ''} auto-attached</span>
        </div>
      )}

      {/* File error toast */}
      {fileError && (
        <div
          className="text-xs px-2 py-1 rounded"
          style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)' }}
        >
          {fileError}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-stretch gap-2">
        {/* Left column: debate toggle + attach */}
        <div className="shrink-0 flex flex-col gap-1">
          {/* Debate mode toggle */}
          {onToggleDebate && (
            <button
              onClick={onToggleDebate}
              className="p-2 rounded-lg transition-colors"
              style={
                debateMode
                  ? { background: 'rgba(82,156,202,0.15)', color: 'var(--color-accent)', border: '1px solid rgba(82,156,202,0.3)' }
                  : { background: 'var(--color-bg-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }
              }
              title={debateMode ? 'Switch to chat mode' : 'Switch to AI debate mode'}
              data-testid="debate-mode-toggle"
            >
              <Swords size={14} />
            </button>
          )}

          {/* Paperclip — file attachment trigger */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="p-2 rounded-lg transition-colors disabled:opacity-50"
            style={{
              background: 'var(--color-bg-surface)',
              color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
            }}
            title="Attach file (images PNG/JPG/WebP, text .txt/.md)"
            aria-label="Attach file"
            data-testid="chat-attach-button"
          >
            <Paperclip size={14} />
          </button>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,text/plain,text/markdown,.md"
          className="hidden"
          data-testid="chat-file-input"
          onChange={e => {
            if (e.target.files?.length) {
              handleFilesSelected(e.target.files)
              // Reset input value so the same file can be re-selected
              e.target.value = ''
            }
          }}
        />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the directors… (Enter to send / Shift+Enter for new line)"
          disabled={isLoading}
          rows={1}
          data-testid="chat-textarea"
          className="flex-1 resize-none rounded-lg px-3 py-2 text-sm"
          style={{
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
            outline: 'none',
            lineHeight: 1.5,
          }}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          data-testid="chat-send-button"
          className="shrink-0 p-2 rounded-lg transition-colors"
          style={{
            background: canSend ? 'var(--color-accent)' : 'var(--color-bg-secondary)',
            color: canSend ? '#fff' : 'var(--color-text-muted)',
            border: '1px solid var(--color-border)',
          }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}
