/**
 * docsCache.ts — IndexedDB persistence for parsed vault documents.
 *
 * Skips IPC file loading + gray-matter parsing entirely when the vault hasn't changed.
 * Also caches folders + imageRegistry to skip the loadFiles IPC on subsequent starts.
 *
 * Cache key  : vaultPath
 * Invalidation: mtime-based fingerprint mismatch = cache miss
 */

import type { LoadedDocument } from '@/types'
import { logger } from './logger'

const DB_NAME = 'strata-sync-docs-cache'
const STORE   = 'docs'
const DB_VERSION = 1
const SCHEMA_VERSION = 2  // v2: includes folders + imageRegistry

type ImageRegistry = Record<string, { relativePath: string; absolutePath: string }>

interface DocsCacheEntry {
  schemaVersion: number
  fingerprint:   string
  docs:          LoadedDocument[]
  folders:       string[]
  imageRegistry: ImageRegistry | null
}

export interface DocsCacheResult {
  docs:          LoadedDocument[]
  folders:       string[]
  imageRegistry: ImageRegistry | null
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
    req.onsuccess  = () => resolve(req.result)
    req.onerror    = () => { _dbPromise = null; reject(req.error) }
  })
  return _dbPromise
}

// ── Path normalization ─────────────────────────────────────────────────────

/** Normalize path separators + remove trailing slash for consistent IDB keys */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/$/, '')
}

// ── Fingerprint ────────────────────────────────────────────────────────────

/** mtime-based fingerprint: detects file additions, deletions, and modifications */
export function buildDocsFingerprint(
  meta: { relativePath: string; mtime: number }[]
): string {
  return [...meta]
    .sort((a, b) => a.relativePath < b.relativePath ? -1 : 1)
    .map(m => `${m.relativePath}:${m.mtime}`)
    .join('|')
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function loadDocsCache(
  vaultPath: string,
  fingerprint: string,
): Promise<DocsCacheResult | null> {
  try {
    const db  = await openDB()
    const tx  = db.transaction(STORE, 'readonly')
    const raw = await new Promise<unknown>((res, rej) => {
      const req = tx.objectStore(STORE).get(normalizePath(vaultPath))
      req.onsuccess = () => res(req.result)
      req.onerror   = () => rej(req.error)
    })
    if (!raw || typeof raw !== 'object') return null
    const cached = raw as DocsCacheEntry
    if (cached.schemaVersion !== SCHEMA_VERSION) return null
    if (cached.fingerprint   !== fingerprint)     return null
    if (!Array.isArray(cached.docs))              return null
    logger.debug(`[docsCache] Cache hit (${cached.docs.length} docs, skipping loadFiles)`)
    return { docs: cached.docs, folders: cached.folders ?? [], imageRegistry: cached.imageRegistry ?? null }
  } catch (err) {
    logger.warn('[docsCache] Cache read failed:', err)
    return null
  }
}

export async function saveDocsCache(
  vaultPath:    string,
  fingerprint:  string,
  docs:         LoadedDocument[],
  folders:      string[],
  imageRegistry: ImageRegistry | null,
): Promise<void> {
  try {
    const db    = await openDB()
    const entry: DocsCacheEntry = { schemaVersion: SCHEMA_VERSION, fingerprint, docs, folders, imageRegistry }
    await new Promise<void>((res, rej) => {
      const tx  = db.transaction(STORE, 'readwrite')
      const req = tx.objectStore(STORE).put(entry, normalizePath(vaultPath))
      req.onsuccess = () => res()
      req.onerror   = () => rej(req.error)
    })
    logger.debug(`[docsCache] Cache saved (${docs.length} docs)`)
  } catch (err) {
    logger.warn('[docsCache] Cache save failed:', err)
  }
}
