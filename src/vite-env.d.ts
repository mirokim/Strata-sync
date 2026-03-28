/// <reference types="vite/client" />

import type { VaultFile, BackendChunk, SearchResult } from '@/types'

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
      ipcSend?: (channel: string, data?: unknown) => void
    }

    // ── windowAPI (Fix 0) — frameless window controls ─────────────────────────
    windowAPI?: {
      minimize(): Promise<void>
      maximize(): Promise<void>
      close(): Promise<void>
      toggleDevTools(): Promise<void>
    }

    // ── vaultAPI (Phase 6) ────────────────────────────────────────────────────
    vaultAPI?: {
      selectFolder(): Promise<string | null>
      loadFiles(dirPath: string): Promise<{
        files: VaultFile[]
        folders: string[]
        imageRegistry?: Record<string, { relativePath: string; absolutePath: string }>
      }>
      scanMetadata?(dirPath: string): Promise<{ relativePath: string; absolutePath: string; mtime: number }[]>
      watchStart(dirPath: string): Promise<boolean>
      watchStop(): Promise<boolean>
      onChanged(callback: (data: { vaultPath: string; changedFile?: string }) => void): () => void
      saveFile(filePath: string, content: string): Promise<{ success: boolean; path: string }>
      setActivePath?(vaultPath: string): Promise<boolean>
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

    // ── configAPI (GUI → mcp-config.json sync) ───────────────────────────────
    configAPI?: {
      writeMcp(patch: Record<string, unknown>): Promise<{ ok: boolean }>
    }

    // ── ragAPI (Slack RAG bridge) ─────────────────────────────────────────────
    ragAPI?: {
      onSearch(callback: (data: { requestId: string; query: string; topN: number }) => void): () => void
      onGetSettings(callback: (data: { requestId: string }) => void): () => void
      onAsk(callback: (data: { requestId: string; query: string; directorId: string; history?: { role: 'user' | 'assistant'; content: string }[]; images?: { data: string; mediaType: string }[] }) => void): () => void
      onGetImages?(callback: (data: { requestId: string; query: string }) => void): () => void
      onMirofish?(callback: (data: { requestId: string; topic: string; numPersonas: number; numRounds: number; modelId: string; context?: string; segment?: string; presetPersonas?: import('./services/mirofish/types').MirofishPersona[]; images?: { data: string; mediaType: string }[] }) => void): () => void
      onGetVaultPath?(callback: (data: { requestId: string }) => void): () => void
      sendResult(requestId: string, results: unknown): void
    }

    // ── botAPI (Slack bot process management) ────────────────────────────────
    botAPI?: {
      start(config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>
      stop(): Promise<{ ok: boolean }>
      getStatus(): Promise<{ running: boolean }>
      getLogs(): Promise<string[]>
      onLog(callback: (line: string) => void): () => void
      onStopped(callback: (data: { code: number | null }) => void): () => void
    }

    // ── toolsAPI — Edit Agent Python tools runner ────────────────────────────
    toolsAPI?: {
      runVaultTool(scriptName: string, args?: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>
    }

    // ── gstackAPI — headless browser automation ──────────────────────────────
    gstackAPI?: {
      execute(command: 'goto' | 'text' | 'snapshot' | 'click' | 'fill' | 'js', args?: string[]): Promise<{ success: boolean; output: string; error?: string }>
    }

    // ── webSearchAPI (DuckDuckGo) ─────────────────────────────────────────────
    webSearchAPI?: {
      search(query: string): Promise<string>
    }

    // ── confluenceAPI (Confluence IPC bridge) ────────────────────────────────
    confluenceAPI?: {
      testConnection(opts: Record<string, unknown>): Promise<{ ok: boolean; displayName: string }>
      fetchPages(opts: Record<string, unknown>): Promise<Array<Record<string, unknown>>>
      savePages(vaultPath: string, targetFolder: string, pages: Array<{ filename: string; content: string }>): Promise<{ saved: number }>
      downloadAttachments(config: Record<string, unknown>, vaultPath: string, targetFolder: string, pageId: string): Promise<{ downloaded: number }>
      runScript(scriptName: string, args?: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>
      rollback(files: string[], dirs: string[]): Promise<{ ok: boolean }>
      getPageInfo(config: Record<string, unknown>, pageIdOrUrl: string): Promise<{ id: string; title: string; version: number; spaceKey: string }>
      createPage(config: Record<string, unknown>, opts: { title: string; storageBody: string; spaceKey?: string; parentId?: string }): Promise<{ id: string; url: string }>
      updatePage(config: Record<string, unknown>, opts: { pageId: string; title: string; storageBody: string; currentVersion: number }): Promise<{ id: string; url: string }>
      readAppFile(relativePath: string): Promise<string | null>
    }

    // ── jiraAPI (Jira IPC bridge) ─────────────────────────────────────────────
    jiraAPI?: {
      testConnection(opts: Record<string, unknown>): Promise<{ ok: boolean; displayName: string }>
      fetchIssues(opts: Record<string, unknown>): Promise<Array<Record<string, unknown>>>
      saveIssues(vaultPath: string, targetFolder: string, issues: Array<{ filename: string; content: string }>): Promise<{ saved: number }>
      getMembers(opts: Record<string, unknown>): Promise<Array<{ accountId: string; displayName: string; emailAddress: string }>>
      createIssue(config: Record<string, unknown>, fields: Record<string, unknown>): Promise<{ key: string; id: string; url: string }>
      rollback(files: string[], dirs: string[]): Promise<{ ok: boolean }>
    }

    // ── reportAPI (PDF report export) ──────────────────────────────────────────
    reportAPI?: {
      exportPdf(html: string, suggestedName?: string): Promise<{ ok: boolean; filePath?: string; reason?: string }>
    }

    // ── backendAPI (Phase 1-3) ────────────────────────────────────────────────
    backendAPI?: {
      getStatus(): Promise<{ ready: boolean; port: number }>
      indexDocuments(chunks: BackendChunk[]): Promise<{ indexed: number }>
      clearIndex(): Promise<{ cleared: boolean }>
      search(query: string, topK?: number): Promise<{ results: SearchResult[]; query: string }>
      getStats(): Promise<{ doc_count: number; chunk_count: number; collection_name: string }>
      onReady(callback: (data: { port: number }) => void): () => void
    }
  }
}

export {}
