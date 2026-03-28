/**
 * Direct filesystem vault access — replaces window.vaultAPI for MCP server.
 */
import { readFileSync, writeFileSync, unlinkSync, renameSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync } from 'fs'
import { join, relative, basename, dirname, extname } from 'path'
import { getConfig } from './config.js'

export interface VaultFileInfo {
  relativePath: string
  absolutePath: string
  mtime: number
}

/** Recursively list all files in vaultPath */
export function listFiles(vaultPath?: string, folder?: string): { files: VaultFileInfo[]; folders: string[] } {
  const root = vaultPath ?? getConfig().vaultPath
  if (!root || !existsSync(root)) return { files: [], folders: [] }

  const target = folder ? join(root, folder) : root
  const files: VaultFileInfo[] = []
  const folders: string[] = []

  function walk(dir: string) {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      if (name.startsWith('.') || name === 'node_modules') continue
      const abs = join(dir, name)
      let stat
      try { stat = statSync(abs) } catch { continue }
      if (stat.isDirectory()) {
        folders.push(relative(root, abs).replace(/\\/g, '/'))
        walk(abs)
      } else {
        files.push({
          relativePath: relative(root, abs).replace(/\\/g, '/'),
          absolutePath: abs,
          mtime: stat.mtimeMs,
        })
      }
    }
  }

  walk(target)
  return { files, folders }
}

export function readFile(filePath: string): string | null {
  try { return readFileSync(filePath, 'utf-8') } catch { return null }
}

export function saveFile(filePath: string, content: string): { success: boolean; path: string } {
  try {
    const dir = dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, content, 'utf-8')
    return { success: true, path: filePath }
  } catch { return { success: false, path: filePath } }
}

export function deleteFile(filePath: string): { success: boolean } {
  try { unlinkSync(filePath); return { success: true } } catch { return { success: false } }
}

export function renameFile(absPath: string, newName: string): { success: boolean; newPath: string } {
  try {
    const dir = dirname(absPath)
    const newPath = join(dir, newName)
    renameSync(absPath, newPath)
    return { success: true, newPath }
  } catch { return { success: false, newPath: '' } }
}

export function createFolder(folderPath: string): { success: boolean; path: string } {
  try {
    mkdirSync(folderPath, { recursive: true })
    return { success: true, path: folderPath }
  } catch { return { success: false, path: folderPath } }
}

export function moveFile(absPath: string, destFolder: string): { success: boolean; newPath: string } {
  try {
    if (!existsSync(destFolder)) mkdirSync(destFolder, { recursive: true })
    const newPath = join(destFolder, basename(absPath))
    copyFileSync(absPath, newPath)
    unlinkSync(absPath)
    return { success: true, newPath }
  } catch { return { success: false, newPath: '' } }
}

/** Load and parse all .md files into LoadedDocument[] */
export async function loadVaultDocuments(vaultPath?: string) {
  const root = vaultPath ?? getConfig().vaultPath
  const { files } = listFiles(root)
  const mdFiles = files.filter(f => extname(f.relativePath).toLowerCase() === '.md')

  // Dynamic import to use the app's parser
  const { parseVaultFile } = await import('./parser.js')

  const docs = []
  for (const f of mdFiles) {
    const content = readFile(f.absolutePath)
    if (!content) continue
    const doc = parseVaultFile({
      relativePath: f.relativePath,
      absolutePath: f.absolutePath,
      content,
      mtime: f.mtime,
    })
    if (doc) docs.push(doc)
  }
  return docs
}
