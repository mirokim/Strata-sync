import { useEditAgentStore } from '@/stores/editAgentStore'

function resetStore() {
  useEditAgentStore.setState({
    isRunning: false,
    lastWakeAt: null,
    logs: [],
    messages: [],
    streamingMessageId: null,
    pendingQueue: [],
    processingFile: null,
  })
}

describe('editAgentStore', () => {
  beforeEach(() => {
    resetStore()
  })

  // ── addLog ────────────────────────────────────────────────────────────────

  describe('addLog()', () => {
    it('adds a log entry with auto-generated id and timestamp', () => {
      const { addLog } = useEditAgentStore.getState()
      addLog({ action: 'wake', detail: 'Agent woke up' })

      const { logs } = useEditAgentStore.getState()
      expect(logs).toHaveLength(1)
      expect(logs[0].action).toBe('wake')
      expect(logs[0].detail).toBe('Agent woke up')
      expect(logs[0].id).toBeTruthy()
      expect(logs[0].timestamp).toBeGreaterThan(0)
    })

    it('prepends new logs (newest first)', () => {
      const { addLog } = useEditAgentStore.getState()
      addLog({ action: 'wake', detail: 'first' })
      addLog({ action: 'done', detail: 'second' })

      const { logs } = useEditAgentStore.getState()
      expect(logs[0].detail).toBe('second')
      expect(logs[1].detail).toBe('first')
    })

    it('caps log entries at 500', () => {
      const { addLog } = useEditAgentStore.getState()
      // Add 501 entries
      for (let i = 0; i < 501; i++) {
        addLog({ action: 'wake', detail: `entry-${i}` })
      }

      const { logs } = useEditAgentStore.getState()
      expect(logs.length).toBe(500)
      // Most recent should be the last added
      expect(logs[0].detail).toBe('entry-500')
    })

    it('supports optional file field', () => {
      const { addLog } = useEditAgentStore.getState()
      addLog({ action: 'file_edit', detail: 'edited', file: 'notes/test.md' })

      const { logs } = useEditAgentStore.getState()
      expect(logs[0].file).toBe('notes/test.md')
    })
  })

  // ── addMessage ──────────────────────────────────────────────────────────

  describe('addMessage()', () => {
    it('adds a user message', () => {
      const { addMessage } = useEditAgentStore.getState()
      const id = addMessage({ role: 'user', content: 'Hello' })

      const { messages } = useEditAgentStore.getState()
      expect(messages).toHaveLength(1)
      expect(messages[0].role).toBe('user')
      expect(messages[0].content).toBe('Hello')
      expect(messages[0].id).toBe(id)
    })

    it('adds an agent message', () => {
      const { addMessage } = useEditAgentStore.getState()
      addMessage({ role: 'agent', content: 'I will refine this file.' })

      const { messages } = useEditAgentStore.getState()
      expect(messages[0].role).toBe('agent')
    })

    it('adds a system message', () => {
      const { addMessage } = useEditAgentStore.getState()
      addMessage({ role: 'system', content: 'System prompt' })

      const { messages } = useEditAgentStore.getState()
      expect(messages[0].role).toBe('system')
    })

    it('appends messages in order', () => {
      const { addMessage } = useEditAgentStore.getState()
      addMessage({ role: 'user', content: 'first' })
      addMessage({ role: 'agent', content: 'second' })

      const { messages } = useEditAgentStore.getState()
      expect(messages[0].content).toBe('first')
      expect(messages[1].content).toBe('second')
    })
  })

  // ── Streaming flow ────────────────────────────────────────────────────

  describe('streaming flow', () => {
    it('beginAgentStream creates an empty agent message and sets streamingMessageId', () => {
      const { beginAgentStream } = useEditAgentStore.getState()
      const id = beginAgentStream()

      const state = useEditAgentStore.getState()
      expect(state.streamingMessageId).toBe(id)
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].role).toBe('agent')
      expect(state.messages[0].content).toBe('')
    })

    it('appendStreamChunk appends text to the streaming message', () => {
      const { beginAgentStream, appendStreamChunk } = useEditAgentStore.getState()
      const id = beginAgentStream()

      appendStreamChunk(id, 'Hello ')
      appendStreamChunk(id, 'world')

      const { messages } = useEditAgentStore.getState()
      expect(messages[0].content).toBe('Hello world')
    })

    it('appendStreamChunk does not affect other messages', () => {
      const { addMessage, beginAgentStream, appendStreamChunk } = useEditAgentStore.getState()
      addMessage({ role: 'user', content: 'prompt' })
      const id = beginAgentStream()
      appendStreamChunk(id, 'response')

      const { messages } = useEditAgentStore.getState()
      expect(messages[0].content).toBe('prompt')
      expect(messages[1].content).toBe('response')
    })

    it('endAgentStream clears streamingMessageId', () => {
      const { beginAgentStream, endAgentStream } = useEditAgentStore.getState()
      const id = beginAgentStream()
      endAgentStream(id)

      expect(useEditAgentStore.getState().streamingMessageId).toBeNull()
    })

    it('endAgentStream with wrong id does not clear streamingMessageId', () => {
      const { beginAgentStream, endAgentStream } = useEditAgentStore.getState()
      const id = beginAgentStream()
      endAgentStream('wrong-id')

      expect(useEditAgentStore.getState().streamingMessageId).toBe(id)
    })
  })

  // ── pendingQueue ──────────────────────────────────────────────────────

  describe('setPendingQueue / removeFromQueue', () => {
    it('sets the pending queue', () => {
      const { setPendingQueue } = useEditAgentStore.getState()
      setPendingQueue(['file1.md', 'file2.md', 'file3.md'])

      expect(useEditAgentStore.getState().pendingQueue).toEqual(['file1.md', 'file2.md', 'file3.md'])
    })

    it('removes a file from the queue', () => {
      const { setPendingQueue, removeFromQueue } = useEditAgentStore.getState()
      setPendingQueue(['a.md', 'b.md', 'c.md'])
      removeFromQueue('b.md')

      expect(useEditAgentStore.getState().pendingQueue).toEqual(['a.md', 'c.md'])
    })

    it('removeFromQueue is a no-op if file not in queue', () => {
      const { setPendingQueue, removeFromQueue } = useEditAgentStore.getState()
      setPendingQueue(['a.md'])
      removeFromQueue('nonexistent.md')

      expect(useEditAgentStore.getState().pendingQueue).toEqual(['a.md'])
    })
  })

  // ── Clear operations ──────────────────────────────────────────────────

  describe('clearLogs()', () => {
    it('removes all log entries', () => {
      const { addLog, clearLogs } = useEditAgentStore.getState()
      addLog({ action: 'wake', detail: 'test' })
      addLog({ action: 'done', detail: 'test2' })
      clearLogs()

      expect(useEditAgentStore.getState().logs).toEqual([])
    })
  })

  describe('clearMessages()', () => {
    it('removes all messages and clears streamingMessageId', () => {
      const { addMessage, beginAgentStream, clearMessages } = useEditAgentStore.getState()
      addMessage({ role: 'user', content: 'hi' })
      beginAgentStream()
      clearMessages()

      const state = useEditAgentStore.getState()
      expect(state.messages).toEqual([])
      expect(state.streamingMessageId).toBeNull()
    })
  })
})
