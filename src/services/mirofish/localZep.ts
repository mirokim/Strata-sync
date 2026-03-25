/**
 * localZep.ts — Local replacement for Zep Cloud (SQLite-based)
 *
 * Uses sql.js (WASM SQLite) to replicate the Zep Cloud agent memory API.
 * Manages per-agent memory within a single simulation session using an in-memory SQLite DB.
 *
 * Zep Cloud API mapping:
 *   client.memory.add(sessionId, messages)       -> LocalZepClient.add()
 *   client.memory.get(sessionId)                 -> LocalZepClient.get()
 *   client.memory.search(sessionId, text, limit) -> LocalZepClient.search()
 */

// @ts-ignore — sql.js has no type declarations
import initSqlJs from 'sql.js'
// @ts-ignore — Vite ?url import
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

export interface ZepMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata?: Record<string, unknown>
}

export interface ZepMemory {
  messages: ZepMessage[]
  /** Corresponds to Zep's auto-summary — context from last 10 messages */
  context: string
}

export interface ZepSearchResult {
  message: ZepMessage
  score: number
}

// sql.js DB instance (shared across entire simulation)
let _db: any | null = null

async function getDb(): Promise<any> {
  if (_db) return _db
  const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl })
  _db = new SQL.Database()
  _db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      session   TEXT    NOT NULL,
      role      TEXT    NOT NULL,
      content   TEXT    NOT NULL,
      metadata  TEXT    DEFAULT '{}',
      created   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session ON messages(session);
  `)
  return _db
}

export class LocalZepClient {
  private dbPromise = getDb()

  /** Zep Cloud: client.memory.add() */
  async add(sessionId: string, messages: ZepMessage[]): Promise<void> {
    const db = await this.dbPromise
    const stmt = db.prepare(
      'INSERT INTO messages (session, role, content, metadata, created) VALUES (?,?,?,?,?)'
    )
    for (const m of messages) {
      stmt.run([sessionId, m.role, m.content, JSON.stringify(m.metadata ?? {}), Date.now()])
    }
    stmt.free()
  }

  /** Zep Cloud: client.memory.get() — fetches only last 30 to prevent memory overload */
  async get(sessionId: string): Promise<ZepMemory> {
    const db = await this.dbPromise
    const res = db.exec(
      'SELECT role, content, metadata FROM messages WHERE session=? ORDER BY id DESC LIMIT 30',
      [sessionId]
    )
    const messages: ZepMessage[] = (res[0]?.values ?? [])
      .reverse()
      .map((row: (string | number | null | Uint8Array)[]) => {
        let metadata: Record<string, unknown> = {}
        try { metadata = JSON.parse((row[2] as string) ?? '{}') } catch { /* ignore corrupted metadata */ }
        return {
          role:     row[0] as ZepMessage['role'],
          content:  row[1] as string,
          metadata,
        }
      })

    const context = messages
      .slice(-10)
      .map(m => `${m.role}: ${m.content}`)
      .join('\n')

    return { messages, context }
  }

  /** Zep Cloud: client.memory.search() — keyword frequency-based relevance scoring */
  async search(sessionId: string, text: string, limit = 5): Promise<ZepSearchResult[]> {
    const { messages } = await this.get(sessionId)
    const words = text.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []

    return messages
      .map(message => {
        const low = message.content.toLowerCase()
        const score = words.reduce((acc, w) => acc + (low.includes(w) ? 1 : 0), 0) / words.length
        return { message, score }
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /** Delete session messages */
  async delete(sessionId: string): Promise<void> {
    const db = await this.dbPromise
    db.run('DELETE FROM messages WHERE session=?', [sessionId])
  }

  /** Full DB reset (release memory after simulation ends) */
  static reset(): void {
    _db?.close()
    _db = null
  }
}
