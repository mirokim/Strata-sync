/**
 * vectorEmbedCache.ts — IndexedDB persistence for vector embeddings.
 *
 * 볼트 문서의 OpenAI text-embedding-3-small 벡터를 영구 저장합니다.
 * 볼트 지문(fingerprint)이 바뀌면 캐시 미스로 처리합니다.
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
 * IndexedDB에서 벡터 임베딩 캐시를 읽습니다.
 * 지문 불일치 / 캐시 없음 시 null 반환.
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
 * 벡터 임베딩 캐시를 IndexedDB에 저장합니다.
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
    // 캐시 저장 실패는 silent — 앱 동작에 영향 없음
  }
}

/**
 * 특정 볼트의 벡터 캐시를 삭제합니다.
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
