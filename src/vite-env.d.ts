/// <reference types="vite/client" />

import type { VaultFile } from '@/types'

export interface RagDocResult {
  doc_id: string
  filename: string
  stem: string
  title: string
  date: string
  tags: string[]
  body: string
  score: number
}

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean
      platform: string
    }

    // ── windowAPI — frameless window controls ─────────────────────────────────
    windowAPI?: {
      minimize(): Promise<void>
      maximize(): Promise<void>
      close(): Promise<void>
      toggleDevTools(): Promise<void>
    }

    // ── vaultAPI — local Obsidian vault access ────────────────────────────────
    vaultAPI?: {
      selectFolder(): Promise<string | null>
      loadFiles(dirPath: string): Promise<{
        files: VaultFile[]
        folders: string[]
        imageRegistry?: Record<string, { relativePath: string; absolutePath: string }>
      }>
      watchStart(dirPath: string): Promise<boolean>
      watchStop(): Promise<boolean>
      onChanged(callback: (data: { vaultPath: string }) => void): () => void
      saveFile(filePath: string, content: string): Promise<{ success: boolean; path: string }>
      renameFile(absolutePath: string, newFilename: string): Promise<{ success: boolean; newPath: string }>
      deleteFile(absolutePath: string): Promise<{ success: boolean }>
      readFile(filePath: string): Promise<string | null>
      /** Read an image file as base64 data URL; returns null if not found or outside vault */
      readImage(filePath: string): Promise<string | null>
      /** Fallback: search the vault for an image by filename (basename), returns data URL or null */
      findImageByName?(filename: string): Promise<string | null>
      createFolder(folderPath: string): Promise<{ success: boolean; path: string }>
      moveFile(absolutePath: string, destFolderPath: string): Promise<{ success: boolean; newPath: string }>
    }

    // ── ragAPI (Slack bot bridge) ─────────────────────────────────────────────
    ragAPI?: {
      onSearch(callback: (data: { requestId: string; query: string; topN: number }) => void): () => void
      onGetSettings(callback: (data: { requestId: string }) => void): () => void
      onAsk(callback: (data: { requestId: string; query: string; directorId: string; history?: { role: 'user' | 'assistant'; content: string }[]; images?: { data: string; mediaType: string }[] }) => void): () => void
      sendResult(requestId: string, results: unknown): void
    }
  }
}

export {}
