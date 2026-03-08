const { contextBridge, ipcRenderer } = require('electron')

// ── electronAPI ────────────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
})

// ── windowAPI (Fix 0) — frameless window controls ─────────────────────────────
contextBridge.exposeInMainWorld('windowAPI', {
  minimize:       () => ipcRenderer.invoke('window:minimize'),
  maximize:       () => ipcRenderer.invoke('window:maximize'),
  close:          () => ipcRenderer.invoke('window:close'),
  toggleDevTools: () => ipcRenderer.invoke('window:toggle-devtools'),
})

// ── vaultAPI (Phase 6) ────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('vaultAPI', {
  /** Open a folder picker dialog; returns the selected path or null */
  selectFolder: () => ipcRenderer.invoke('vault:select-folder'),

  /** Load all .md files from the given absolute vault path */
  loadFiles: (dirPath) => ipcRenderer.invoke('vault:load-files', dirPath),

  /** Start watching the vault directory for changes (debounced 500ms) */
  watchStart: (dirPath) => ipcRenderer.invoke('vault:watch-start', dirPath),

  /** Stop the active file watcher */
  watchStop: () => ipcRenderer.invoke('vault:watch-stop'),

  /** Save a file to the filesystem (used by MD converter and editor) */
  saveFile: (filePath, content) => ipcRenderer.invoke('vault:save-file', filePath, content),

  /** Rename a file — newFilename is just the filename (no path) */
  renameFile: (absolutePath, newFilename) =>
    ipcRenderer.invoke('vault:rename-file', absolutePath, newFilename),

  /** Permanently delete a file */
  deleteFile: (absolutePath) => ipcRenderer.invoke('vault:delete-file', absolutePath),

  /** Read a single file by absolute path; returns null if not found */
  readFile: (filePath) => ipcRenderer.invoke('vault:read-file', filePath),

  /** Read an image file as base64 data URL; returns null if not found or outside vault */
  readImage: (filePath) => ipcRenderer.invoke('vault:read-image', filePath),

  /** Fallback: find an image anywhere in the vault by its filename (basename search) */
  findImageByName: (filename) => ipcRenderer.invoke('vault:find-image-by-name', filename),

  /** Create a directory (and any missing parents) inside the vault */
  createFolder: (folderPath) => ipcRenderer.invoke('vault:create-folder', folderPath),

  /** Move a file to a different folder inside the vault */
  moveFile: (absolutePath, destFolderPath) =>
    ipcRenderer.invoke('vault:move-file', absolutePath, destFolderPath),

  /**
   * Subscribe to vault file-change events.
   * Returns a cleanup function that removes the listener.
   */
  onChanged: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('vault:changed', listener)
    return () => ipcRenderer.removeListener('vault:changed', listener)
  },
})

// ── confluenceAPI ─────────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('confluenceAPI', {
  /** Fetch all pages from a Confluence space. Returns raw page objects. */
  fetchPages: (config) => ipcRenderer.invoke('confluence:fetch-pages', config),

  /** Save converted markdown files to the vault. */
  savePages: (vaultPath, targetFolder, pagesWithMd) =>
    ipcRenderer.invoke('confluence:save-pages', vaultPath, targetFolder, pagesWithMd),

  /** Download image attachments for a single page. */
  downloadAttachments: (config, vaultPath, targetFolder, pageId) =>
    ipcRenderer.invoke('confluence:download-attachments', config, vaultPath, targetFolder, pageId),

  /** Run a Python script from manual/scripts/. Returns { stdout, stderr, exitCode }. */
  runScript: (scriptName, args) =>
    ipcRenderer.invoke('tools:run-script', scriptName, args),

  /** Delete saved files and remove empty dirs. Returns { deleted, errors }. */
  rollback: (files, dirs) =>
    ipcRenderer.invoke('confluence:rollback', files, dirs),

  /** Read a file from the app directory (e.g. 'manual/foo.md'). Returns text or null. */
  readAppFile: (relativePath) =>
    ipcRenderer.invoke('tools:read-app-file', relativePath),
})


// ── ragAPI (Slack RAG bridge) ─────────────────────────────────────────────────
contextBridge.exposeInMainWorld('ragAPI', {
  /** Listen for search requests from the HTTP server (via main process). */
  onSearch: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('rag:search', listener)
    return () => ipcRenderer.removeListener('rag:search', listener)
  },
  /** Listen for settings requests from the HTTP server (via main process). */
  onGetSettings: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('rag:get-settings', listener)
    return () => ipcRenderer.removeListener('rag:get-settings', listener)
  },
  /** Listen for full-answer generation requests (Slack /ask endpoint). */
  onAsk: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('rag:ask', listener)
    return () => ipcRenderer.removeListener('rag:ask', listener)
  },
  /** Send results/settings back to the HTTP server (via main process). */
  sendResult: (requestId, results) => {
    ipcRenderer.send('rag:result', { requestId, results })
  },
})
