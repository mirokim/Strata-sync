/**
 * Confluence REST API v1 client (renderer-side fetch).
 *
 * Confluence Cloud: Basic auth — base64("email:apiToken")
 * Confluence Server/DC: Bearer PAT
 *
 * CORS note: Confluence Cloud allows CORS from any origin.
 * On-premise Confluence may need CORS headers configured on the server.
 */

import { getAttachmentType, type ConfluencePage, type ConfluenceAttachment } from '@/lib/confluenceConverter'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConfluenceAuthType = 'cloud' | 'server'

export interface ConfluenceCredentials {
  /** Base URL WITHOUT trailing slash — e.g. "https://company.atlassian.net/wiki" */
  baseUrl: string
  /**
   * Pre-built Authorization header value:
   *   Cloud  → "Basic base64(email:token)"
   *   Server → "Bearer PAT"
   */
  authHeader: string
}

export interface ConfluencePageSummary {
  id: string
  title: string
  spaceKey: string
}

export interface ConfluencePageDetail {
  id: string
  title: string
  /** Confluence HTML "view" format (rendered, stripped of Confluence-specific macros) */
  bodyHtml: string
  created: string   // YYYY-MM-DD
  modified: string  // YYYY-MM-DD
}

export interface ConfluenceAttachmentInfo {
  id: string
  title: string       // filename
  mediaType: string
  fileSize: number    // bytes
  downloadPath: string // relative path — prepend baseUrl
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

/** Build Basic auth header from Atlassian Cloud email + API token */
export function makeBasicAuth(email: string, token: string): string {
  return 'Basic ' + btoa(`${email}:${token}`)
}

/** Build Bearer auth header from Personal Access Token (Server/DC) */
export function makePATAuth(pat: string): string {
  return `Bearer ${pat}`
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

function headers(creds: ConfluenceCredentials): HeadersInit {
  return {
    Authorization: creds.authHeader,
    Accept: 'application/json',
  }
}

async function cfetch<T>(url: string, creds: ConfluenceCredentials): Promise<T> {
  const res = await fetch(url, { headers: headers(creds) })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try { const body = await res.json(); msg = body.message ?? msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * Fetch a list of pages.
 * If spaceKey is provided, limits to that space.
 * Paginates automatically to return up to 500 pages.
 */
export async function fetchPages(
  creds: ConfluenceCredentials,
  spaceKey?: string,
): Promise<ConfluencePageSummary[]> {
  const all: ConfluencePageSummary[] = []
  let start = 0
  const limit = 50

  while (true) {
    const params = new URLSearchParams({
      type: 'page',
      status: 'current',
      limit: String(limit),
      start: String(start),
      expand: 'space',
      ...(spaceKey ? { spaceKey } : {}),
    })

    const data = await cfetch<{ results: unknown[]; size: number }>(
      `${creds.baseUrl}/rest/api/content?${params}`,
      creds,
    )

    for (const p of data.results as Array<Record<string, unknown>>) {
      all.push({
        id: String(p['id']),
        title: String(p['title']),
        spaceKey: (p['space'] as Record<string, string> | undefined)?.['key'] ?? '',
      })
    }

    if (data.size < limit || all.length >= 500) break
    start += limit
  }

  return all
}

/** Fetch full page content (HTML view format) and metadata */
export async function fetchPageDetail(
  creds: ConfluenceCredentials,
  pageId: string,
): Promise<ConfluencePageDetail> {
  const params = new URLSearchParams({
    expand: 'body.view,history,history.lastUpdated',
  })

  const p = await cfetch<Record<string, unknown>>(
    `${creds.baseUrl}/rest/api/content/${pageId}?${params}`,
    creds,
  )

  const history = p['history'] as Record<string, unknown> | undefined
  const lastUpdated = history?.['lastUpdated'] as Record<string, string> | undefined
  const body = p['body'] as Record<string, unknown> | undefined
  const viewBody = body?.['view'] as Record<string, string> | undefined

  return {
    id: String(p['id']),
    title: String(p['title']),
    bodyHtml: viewBody?.['value'] ?? '',
    created: (history?.['createdDate'] as string | undefined)?.split('T')[0] ?? '',
    modified: lastUpdated?.['when']?.split('T')[0] ?? '',
  }
}

/** Fetch the list of attachments for a page */
export async function fetchAttachments(
  creds: ConfluenceCredentials,
  pageId: string,
): Promise<ConfluenceAttachmentInfo[]> {
  try {
    const data = await cfetch<{ results: unknown[] }>(
      `${creds.baseUrl}/rest/api/content/${pageId}/child/attachment?limit=50&expand=metadata`,
      creds,
    )

    return (data.results as Array<Record<string, unknown>>).map(a => {
      const meta = a['metadata'] as Record<string, unknown> | undefined
      const links = a['_links'] as Record<string, string> | undefined
      return {
        id: String(a['id']),
        title: String(a['title']),
        mediaType: String(meta?.['mediaType'] ?? ''),
        fileSize: Number(meta?.['mediaFileSize'] ?? 0),
        downloadPath: links?.['download'] ?? '',
      }
    })
  } catch {
    return []
  }
}

/** Max attachment size to download automatically (10 MB) */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** Download a Confluence attachment as a browser File object */
export async function downloadAttachmentAsFile(
  creds: ConfluenceCredentials,
  att: ConfluenceAttachmentInfo,
): Promise<File> {
  if (att.fileSize > MAX_ATTACHMENT_BYTES) {
    throw new Error(`File size exceeded (${(att.fileSize / 1024 / 1024).toFixed(1)} MB > 10 MB)`)
  }

  const url = `${creds.baseUrl}${att.downloadPath}`
  const res = await fetch(url, { headers: { Authorization: creds.authHeader } })
  if (!res.ok) throw new Error(`Download failed: ${att.title} (${res.status})`)

  const buffer = await res.arrayBuffer()
  return new File([buffer], att.title, { type: att.mediaType })
}

// ── High-level builder ────────────────────────────────────────────────────────

/**
 * Wrap Confluence API page detail into the same HTML structure as downloaded
 * pages so that `convertConfluencePage()` can be reused without modification.
 */
function wrapAsDownloadedHtml(detail: ConfluencePageDetail): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${detail.title}</title></head>
<body>
  <h1>${detail.title}</h1>
  <div class="meta">
    Created: ${detail.created} &nbsp;|&nbsp; Modified: ${detail.modified}
  </div>
  ${detail.bodyHtml}
</body>
</html>`
}

/**
 * Fetch a page + its doc attachments from the Confluence API and return a
 * `ConfluencePage` object compatible with `convertConfluencePage()`.
 *
 * @param onProgress Optional callback for progress reporting
 */
export async function buildConfluencePage(
  creds: ConfluenceCredentials,
  summary: ConfluencePageSummary,
  onProgress?: (msg: string) => void,
): Promise<ConfluencePage> {
  onProgress?.('Fetching page content…')

  const detail = await fetchPageDetail(creds, summary.id)
  const htmlString = wrapAsDownloadedHtml(detail)

  // Create a synthetic File so confluenceConverter.ts reads it the same way
  const htmlFile = new File(
    [htmlString],
    `${summary.id}_${summary.title}.html`,
    { type: 'text/html' },
  )

  onProgress?.('Fetching attachment list…')

  const attInfos = await fetchAttachments(creds, summary.id)
  const docTypes = ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls'] as const
  const docAttInfos = attInfos.filter(a => {
    const ext = a.title.split('.').pop()?.toLowerCase() ?? ''
    return (docTypes as readonly string[]).includes(ext) && a.fileSize <= MAX_ATTACHMENT_BYTES
  })

  const attachments: ConfluenceAttachment[] = []
  for (const attInfo of docAttInfos) {
    onProgress?.(`Downloading attachment: ${attInfo.title}`)
    try {
      const file = await downloadAttachmentAsFile(creds, attInfo)
      attachments.push({ file, type: getAttachmentType(attInfo.title) })
    } catch {
      // Skip attachments that fail to download
    }
  }

  // Add image entries (metadata only, no download)
  for (const attInfo of attInfos) {
    const ext = attInfo.title.split('.').pop()?.toLowerCase() ?? ''
    if (/^(png|jpg|jpeg|gif|webp|svg|bmp)$/.test(ext)) {
      // Create a tiny placeholder File — the converter just lists image names
      attachments.push({
        file: new File([], attInfo.title, { type: attInfo.mediaType }),
        type: 'image',
      })
    }
  }

  return {
    id: summary.id,
    title: summary.title,
    htmlFile,
    attachments,
  }
}
