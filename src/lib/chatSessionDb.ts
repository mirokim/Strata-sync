/**
 * chatSessionDb.ts — Chat session IndexedDB persistence
 *
 * DB: 'strata-sync-chat', Store: 'sessions'
 * Key: 'default' (single session; multi-tab sessions for future expansion)
 */
import type { ChatMessage } from '@/types'

const DB_NAME    = 'strata-sync-chat'
const DB_VERSION = 1
const STORE_NAME = 'sessions'
const SESSION_KEY = 'default'
const MAX_MESSAGES = 200  // Maximum messages to retain

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

export async function saveChatSession(messages: ChatMessage[]): Promise<void> {
  try {
    // Mark streaming messages as complete before saving
    const toSave = messages
      .filter(m => m.content || m.role === 'user')
      .map(m => ({ ...m, streaming: false }))
      .slice(-MAX_MESSAGES)
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(toSave, SESSION_KEY)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror    = () => { db.close(); reject(tx.error) }
    })
  } catch {
    // Persistence failure is silently ignored — does not affect app behavior
  }
}

export async function loadChatSession(): Promise<ChatMessage[]> {
  try {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(SESSION_KEY)
      req.onsuccess = () => { db.close(); resolve(Array.isArray(req.result) ? req.result : []) }
      req.onerror   = () => { db.close(); reject(req.error) }
    })
  } catch {
    return []
  }
}

export async function clearChatSession(): Promise<void> {
  try {
    const db = await openDb()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(SESSION_KEY)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror    = () => { db.close(); resolve() }
    })
  } catch { /* silently ignored */ }
}
