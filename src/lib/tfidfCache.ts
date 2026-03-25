/**
 * tfidfCache.ts — IndexedDB persistence for the TF-IDF index.
 *
 * When reopening a vault, if files have not changed, the cache is restored
 * without recomputation.
 *
 * Cache key : vaultPath (string)
 * Invalidation : cache miss when the id + mtime fingerprint of the docs list changes
 * Schema version : cache miss when SerializedTfIdf.schemaVersion differs
 */

import type { SerializedTfIdf } from './graphAnalysis'
import { TFIDF_SCHEMA_VERSION } from './graphAnalysis'
import type { LoadedDocument } from '@/types'
import { logger } from './logger'

const DB_NAME = 'strata-sync-tfidf-cache'
const STORE = 'index'
const DB_VERSION = 1

// ── IndexedDB helpers ──────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
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

// ── Fingerprint ────────────────────────────────────────────────────────────

/**
 * Generates a cache-validity fingerprint from the vault document list.
 * If files are added, removed, or modified, the fingerprint changes and triggers a cache miss.
 */
export function buildFingerprint(docs: LoadedDocument[]): string {
  return docs.map(d => `${d.id}:${d.mtime ?? 0}`).join('|')
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Reads the TF-IDF cache from IndexedDB.
 * Returns null on cache miss (not found / fingerprint mismatch / schema version mismatch).
 */
export async function loadTfIdfCache(
  vaultPath: string,
  fingerprint: string,
): Promise<SerializedTfIdf | null> {
  try {
    const db = await openDB()
    const raw = await idbGet(db, vaultPath)
    db.close()
    if (!raw || typeof raw !== 'object') return null
    const cached = raw as SerializedTfIdf
    if (cached.schemaVersion !== TFIDF_SCHEMA_VERSION) return null
    if (cached.fingerprint !== fingerprint) return null
    return cached
  } catch (err) {
    logger.warn('[tfidfCache] Cache read failed:', err)
    return null
  }
}

/**
 * Deletes the TF-IDF cache for a specific vault from IndexedDB.
 * Called after the Edit Agent modifies files -> triggers index rebuild on next search.
 */
export async function invalidateTfIdfCache(vaultPath: string): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const req = tx.objectStore(STORE).delete(vaultPath)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
    db.close()
    logger.debug('[tfidfCache] Cache invalidated')
  } catch (err) {
    logger.warn('[tfidfCache] Cache invalidation failed:', err)
  }
}

/**
 * Saves the TF-IDF index to IndexedDB.
 * Failures do not affect app behavior (warning log only).
 */
export async function saveTfIdfCache(
  vaultPath: string,
  data: SerializedTfIdf,
): Promise<void> {
  try {
    const db = await openDB()
    await idbPut(db, vaultPath, data)
    db.close()
    logger.debug(`[tfidfCache] Cache saved (${data.docs.length} documents)`)
  } catch (err) {
    logger.warn('[tfidfCache] Cache save failed:', err)
  }
}
