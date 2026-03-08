/**
 * useDocumentFilter.ts — Phase 6 update
 *
 * Provides filtered, sorted, and grouped document lists for the FileTree.
 * Mock fallback: if no vault is loaded, falls back to MOCK_DOCUMENTS.
 *
 * Vault mode: groups by folder path (matching Obsidian sidebar)
 * Mock mode: groups by speaker
 */

import { useState, useMemo } from 'react'
import type { SpeakerId } from '@/types'
import type { MockDocument, LoadedDocument } from '@/types'
import { MOCK_DOCUMENTS } from '@/data/mockDocuments'
import { useVaultStore } from '@/stores/vaultStore'
import { SPEAKER_IDS } from '@/lib/speakerConfig'

type AnyDoc = MockDocument  // LoadedDocument is structurally compatible

export type SortBy = 'name' | 'date'
export type SortDir = 'asc' | 'desc'

export interface FolderGroup {
  folderPath: string
  docs: AnyDoc[]
}

export interface TagGroup {
  tag: string  // '' = no tag
  docs: AnyDoc[]
}

function sortDocs(docs: AnyDoc[], sortBy: SortBy, sortDir: SortDir): AnyDoc[] {
  return [...docs].sort((a, b) => {
    let cmp = 0
    if (sortBy === 'name') {
      cmp = a.filename.localeCompare(b.filename, undefined, { numeric: true })
    } else {
      // Sort by mtime (LoadedDocument) or date string (MockDocument)
      const aTime = (a as LoadedDocument).mtime ?? new Date(a.date || 0).getTime()
      const bTime = (b as LoadedDocument).mtime ?? new Date(b.date || 0).getTime()
      cmp = aTime - bTime
    }
    return sortDir === 'asc' ? cmp : -cmp
  })
}

export function useDocumentFilter() {
  const { vaultPath, loadedDocuments } = useVaultStore()
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const isVaultLoaded = Boolean(vaultPath && loadedDocuments)

  // Mock fallback: if no vault is loaded, use MOCK_DOCUMENTS
  const allDocuments = (vaultPath && loadedDocuments) ? loadedDocuments as AnyDoc[] : MOCK_DOCUMENTS

  const filtered = useMemo(() => {
    if (!search.trim()) return allDocuments
    const q = search.toLowerCase()
    return allDocuments.filter(doc =>
      doc.filename.toLowerCase().includes(q) ||
      doc.tags.some(t => t.toLowerCase().includes(q)) ||
      doc.sections.some(s => s.heading.toLowerCase().includes(q))
    )
  }, [allDocuments, search])

  // Speaker-based grouping (mock mode)
  const grouped = useMemo(() => {
    const map: Partial<Record<SpeakerId, AnyDoc[]>> = {}
    for (const id of SPEAKER_IDS) {
      map[id] = sortDocs(filtered.filter(d => d.speaker === id), sortBy, sortDir)
    }
    const unknownDocs = filtered.filter(d => d.speaker === 'unknown')
    if (unknownDocs.length > 0) {
      map['unknown' as SpeakerId] = sortDocs(unknownDocs, sortBy, sortDir)
    }
    return map
  }, [filtered, sortBy, sortDir])

  // Folder-based grouping (vault mode)
  const folderGroups = useMemo((): FolderGroup[] => {
    if (!isVaultLoaded) return []

    const map = new Map<string, AnyDoc[]>()
    for (const doc of filtered) {
      const folder = (doc as LoadedDocument).folderPath ?? ''
      if (!map.has(folder)) map.set(folder, [])
      map.get(folder)!.push(doc)
    }

    // Sort: root ('') first, then alphabetically by folder name
    return Array.from(map.entries())
      .sort(([a], [b]) => {
        if (a === '' && b !== '') return -1
        if (a !== '' && b === '') return 1
        return a.localeCompare(b)
      })
      .map(([folderPath, docs]) => ({
        folderPath,
        docs: sortDocs(docs, sortBy, sortDir),
      }))
  }, [filtered, isVaultLoaded, sortBy, sortDir])

  // Tag-based grouping (vault mode)
  const tagGroups = useMemo((): TagGroup[] => {
    if (!isVaultLoaded) return []

    const map = new Map<string, AnyDoc[]>()
    for (const doc of filtered) {
      if (doc.tags.length === 0) {
        if (!map.has('')) map.set('', [])
        map.get('')!.push(doc)
      } else {
        for (const tag of doc.tags) {
          if (!map.has(tag)) map.set(tag, [])
          map.get(tag)!.push(doc)
        }
      }
    }

    // Sort: alphabetical, '' (untagged) last
    return Array.from(map.entries())
      .sort(([a], [b]) => {
        if (a === '' && b !== '') return 1
        if (a !== '' && b === '') return -1
        return a.localeCompare(b)
      })
      .map(([tag, docs]) => ({ tag, docs: sortDocs(docs, sortBy, sortDir) }))
  }, [filtered, isVaultLoaded, sortBy, sortDir])

  const toggleSortDir = () => setSortDir(d => d === 'asc' ? 'desc' : 'asc')

  return {
    search,
    setSearch,
    sortBy,
    setSortBy,
    sortDir,
    toggleSortDir,
    filtered,
    grouped,
    folderGroups,
    tagGroups,
    totalCount: allDocuments.length,
    isVaultLoaded,
  }
}
