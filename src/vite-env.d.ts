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
      ipcSend?(channel: string, data: unknown): void
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
      /** Scan file metadata (mtime only, no content) for cache fingerprint checks */
      scanMetadata?(dirPath: string): Promise<{ relativePath: string; mtime: number }[]>
      /** Set the active vault path in the main process (used for security checks) */
      setActivePath?(dirPath: string): Promise<void>
    }

    // ── ragAPI (Slack bot bridge) ─────────────────────────────────────────────
    ragAPI?: {
      getToken(): Promise<string>
      onSearch(callback: (data: { requestId: string; query: string; topN: number }) => void): () => void
      onGetSettings(callback: (data: { requestId: string }) => void): () => void
      onAsk(callback: (data: { requestId: string; query: string; directorId: string; history?: { role: 'user' | 'assistant'; content: string }[]; images?: { data: string; mediaType: string }[] }) => void): () => void
      onGetImages?(callback: (data: { requestId: string; query: string }) => void): () => void
      onMirofish?(callback: (data: { requestId: string; topic: string; numPersonas: number; numRounds: number; modelId: string; context?: string; segment?: string; presetPersonas?: unknown[]; images?: { data: string; mediaType: string }[] }) => void): () => void
      onGetVaultPath?(callback: (data: { requestId: string }) => void): () => void
      sendResult(requestId: string, results: unknown): void
    }

    // ── confluenceAPI — Confluence import ───────────────────────────────────────
    confluenceAPI?: {
      fetchPages(config: Record<string, unknown>): Promise<unknown[]>
      savePages(vaultPath: string, targetFolder: string, pagesWithMd: { filename: string; content: string }[]): Promise<{ saved: number; targetDir: string; activeDir: string; files: string[] }>
      downloadAttachments(config: Record<string, unknown>, vaultPath: string, targetFolder: string, pageId: string): Promise<{ downloaded: number; files: string[] }>
      runScript(scriptName: string, args?: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>
      rollback(files: string[], dirs: string[]): Promise<{ deleted: number; errors: string[] }>
      readAppFile(relativePath: string): Promise<string | null>
    }

    // ── botAPI — Slack bot process management ─────────────────────────────────
    botAPI?: {
      start(config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>
      stop(): Promise<{ ok: boolean }>
      getStatus(): Promise<{ running: boolean }>
      getLogs(): Promise<string[]>
      onLog(callback: (line: string) => void): () => void
      onStopped(callback: (data: { code: number | null }) => void): () => void
    }

    // ── reportAPI — PDF report export ─────────────────────────────────────────
    reportAPI?: {
      exportPdf(html: string, suggestedName?: string): Promise<{ ok: boolean; filePath?: string; reason?: string }>
    }

    // ── webSearchAPI — DuckDuckGo web search ──────────────────────────────────
    webSearchAPI?: {
      search(query: string): Promise<string>
    }

    // ── toolsAPI — Python script execution from tools/ folder ─────────────────
    toolsAPI?: {
      runVaultTool(scriptName: string, args?: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>
    }

    // ── gstackAPI — Headless browser automation ───────────────────────────────
    gstackAPI?: {
      execute(command: string, args?: string[]): Promise<{ success: boolean; output: string; error?: string }>
    }
  }
}

export {}
