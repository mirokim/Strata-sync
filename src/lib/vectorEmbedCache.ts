/**
 * vectorEmbedCache.ts — IndexedDB persistence for vector embeddings.
 *
 * Permanently stores OpenAI text-embedding-3-small vectors for vault documents.
 * Treats it as a cache miss when the vault fingerprint changes.
 */

const DB_NAME = 'strata-sync-vector-embed'
const STORE = 'embeddings'
const DB_VERSION = 1

interface VectorCacheRecord {
  fingerprint: string
  entries: Array<{ docId: string; embedding: number[] }>
}

// ── IndexedDB singleton ────────────────────────────────────────────────────

let _dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { _dbPromise = null; reject(req.error) }
  })
  return _dbPromise
}

async function idbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).put(value, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Reads vector embedding cache from IndexedDB.
 * Returns null on fingerprint mismatch or cache miss.
 */
export async function loadVectorEmbedCache(
  vaultPath: string,
  fingerprint: string,
): Promise<Map<string, number[]> | null> {
  try {
    const db = await openDB()
    const raw = await idbGet(db, vaultPath)
    if (!raw || typeof raw !== 'object') return null
    const record = raw as VectorCacheRecord
    if (record.fingerprint !== fingerprint) return null
    if (!Array.isArray(record.entries)) return null
    return new Map(record.entries.map(e => [e.docId, e.embedding]))
  } catch {
    return null
  }
}

/**
 * Saves vector embedding cache to IndexedDB.
 */
export async function saveVectorEmbedCache(
  vaultPath: string,
  fingerprint: string,
  embeddings: Map<string, number[]>,
): Promise<void> {
  try {
    const db = await openDB()
    const record: VectorCacheRecord = {
      fingerprint,
      entries: [...embeddings.entries()].map(([docId, embedding]) => ({ docId, embedding })),
    }
    await idbPut(db, vaultPath, record)
  } catch {
    // Cache save failure is silent — does not affect app behavior
  }
}

/**
 * Deletes the vector cache for a specific vault.
 */
export async function invalidateVectorEmbedCache(vaultPath: string): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const req = tx.objectStore(STORE).delete(vaultPath)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch {
    // silent
  }
}
