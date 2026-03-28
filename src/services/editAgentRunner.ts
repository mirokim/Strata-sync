/**
 * Edit Agent Runner — autonomous wake cycle.
 *
 * One wake cycle:
 *   1. Load vault file list
 *   2. For each .md file, check if it needs refinement (basic heuristics)
 *   3. Read file content → call LLM with refinement manual
 *   4. Parse LLM output for edits → apply + save
 *   5. Log all actions to editAgentStore + JSONL log file
 */

import { useVaultStore } from '@/stores/vaultStore'
import { useSettingsStore, getApiKey } from '@/stores/settingsStore'
import { useEditAgentStore } from '@/stores/editAgentStore'
import { streamMessageRaw } from '@/services/llmClient'
import { useUsageStore } from '@/stores/usageStore'
import { showToast } from '@/stores/toastStore'
import { logger } from '@/lib/logger'
import { formatLocalDate } from '@/lib/formatUtils'
import { invalidateTfIdfCache } from '@/lib/tfidfCache'
import { EDIT_AGENT_LOG_PATH, AGENT_MAX_OUTPUT_TOKENS, EDIT_AGENT_MAX_FILE_CHARS } from '@/lib/constants'

// ── Constants ──────────────────────────────────────────────────────────────────

const LOG_FILE = EDIT_AGENT_LOG_PATH
const MAX_FILE_CHARS = EDIT_AGENT_MAX_FILE_CHARS
const MAX_FILES_PER_CYCLE = 10

// ── Log persistence ────────────────────────────────────────────────────────────

async function appendLogToFile(vaultPath: string, entry: object): Promise<void> {
  try {
    const logPath = `${vaultPath}/${LOG_FILE}`
    const existing = (await window.vaultAPI?.readFile(logPath)) ?? ''
    const newContent = existing + JSON.stringify(entry) + '\n'
    await window.vaultAPI?.saveFile(logPath, newContent)
  } catch {
    // Non-fatal — log to console only
  }
}

// ── File heuristics: should this file be refined? ─────────────────────────────

function needsRefinement(content: string): boolean {
  if (!content || content.length < 100) return false
  // Skip if recently refined (has agent stamp within last 24h)
  const match = content.match(/<!-- edit-agent: (\d{4}-\d{2}-\d{2}) -->/)
  if (match) {
    const stampAge = Date.now() - Date.parse(match[1])
    if (stampAge < 24 * 60 * 60 * 1000) return false
  }
  return true
}

// ── LLM prompt builder ─────────────────────────────────────────────────────────

/** Build integration status for system prompt context */
interface IntegrationStatus {
  confluence: { connected: boolean; spaceKey?: string; baseUrl?: string }
  jira: { connected: boolean; projectKey?: string; baseUrl?: string }
}

function buildIntegrationStatus(vaultId: string): IntegrationStatus {
  const { confluenceConfigs, jiraConfigs } = useSettingsStore.getState()
  const cc = confluenceConfigs[vaultId] ?? confluenceConfigs['__migrated__']
  const jc = jiraConfigs[vaultId] ?? jiraConfigs['__migrated__']
  return {
    confluence: {
      connected: Boolean(cc?.baseUrl && cc?.apiToken),
      spaceKey: cc?.spaceKey || undefined,
      baseUrl: cc?.baseUrl || undefined,
    },
    jira: {
      connected: Boolean(jc?.baseUrl && jc?.apiToken),
      projectKey: jc?.projectKey || undefined,
      baseUrl: jc?.baseUrl || undefined,
    },
  }
}

function buildSystemPrompt(manual: string, vaultPath?: string | null, integrations?: IntegrationStatus): string {
  const confLine = integrations
    ? (integrations.confluence.connected
        ? `- Confluence: connected${integrations.confluence.spaceKey ? ` (space: ${integrations.confluence.spaceKey})` : ''}`
        : `- Confluence: not configured (confluence_import tool unavailable)`)
    : null
  const jiraLine = integrations
    ? (integrations.jira.connected
        ? `- Jira: connected${integrations.jira.projectKey ? ` (project: ${integrations.jira.projectKey})` : ''}`
        : `- Jira: not configured (jira_import tool unavailable)`)
    : null

  return (
    `You are a vault refinement agent. The refinement manual below is a set of binding rules you must follow.\n` +
    `Use the rules and criteria specified in the manual as the top priority for all decisions.\n` +
    `Do not make arbitrary modifications or apply personal preferences not specified in the manual.\n\n` +
    `===== Refinement Manual (Binding Rules) =====\n` +
    manual +
    `\n===== End of Manual =====\n\n` +
    `Today's date: ${formatLocalDate()}` +
    (vaultPath ? `\nCurrent vault path: ${vaultPath}` : '') +
    (confLine && jiraLine ? `\n\nConnected external services:\n${confLine}\n${jiraLine}` : '')
  )
}

function buildRefinementPrompt(content: string, filename: string): string {
  return (
    `Filename: ${filename}\n\n` +
    `Review and improve the document below according to the refinement manual rules in the system prompt.\n\n` +
    `## Working Principles (Manual Takes Priority)\n` +
    `- Apply the frontmatter format, link rules, section structure, and tag standards specified in the manual as-is.\n` +
    `- If the manual criteria are already met, set skip: true. Do not make unnecessary changes.\n` +
    `- Do not make style changes, summarize content, or rephrase sentences unless specified in the manual.\n` +
    `- Never alter the factual content or meaning of the original.\n\n` +
    `## Output Format (JSON block only, no other text)\n\n` +
    `\`\`\`json\n` +
    `{\n` +
    `  "skip": false,\n` +
    `  "reason": "Items needing improvement per manual criteria (or reason for skip=true)",\n` +
    `  "content": "Improved full markdown content (only when skip=false)"\n` +
    `}\n` +
    `\`\`\`\n\n` +
    `--- Document Content ---\n${content}`
  )
}

// ── Parse LLM JSON response ────────────────────────────────────────────────────

interface RefinementResult {
  skip: boolean
  reason: string
  content?: string
}

function parseRefinementResponse(raw: string): RefinementResult | null {
  let parsed: unknown
  const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/)
  if (jsonMatch) {
    try { parsed = JSON.parse(jsonMatch[1].trim()) } catch (e) {
      logger.warn('[EditAgent] JSON parse failed (code block):', e instanceof Error ? e.message : String(e), raw.slice(0, 120))
      return null
    }
  } else {
    const bare = raw.trim()
    if (!bare.startsWith('{')) return null
    try { parsed = JSON.parse(bare) } catch (e) {
      logger.warn('[EditAgent] JSON parse failed (bare):', e instanceof Error ? e.message : String(e), raw.slice(0, 120))
      return null
    }
  }
  // Field-level validation
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>
  if (typeof p.skip !== 'boolean') return null
  if (typeof p.reason !== 'string') return null
  if (!p.skip && p.content !== undefined && typeof p.content !== 'string') return null
  return {
    skip: p.skip,
    reason: p.reason,
    content: typeof p.content === 'string' ? p.content : undefined,
  }
}

// ── Agent stamp injection ──────────────────────────────────────────────────────

function stampContent(content: string): string {
  const today = formatLocalDate()
  const stamp = `<!-- edit-agent: ${today} -->`
  // Remove old stamp if present
  const cleaned = content.replace(/<!-- edit-agent: \d{4}-\d{2}-\d{2} -->\n?/, '')
  return stamp + '\n' + cleaned
}

// ── Main wake cycle ────────────────────────────────────────────────────────────

let _cycleRunning = false

/**
 * Run one complete wake cycle.
 * Called by useEditAgent hook on the configured interval.
 * Returns true if cycle completed normally, false if aborted.
 */
export async function runEditAgentCycle(): Promise<boolean> {
  if (_cycleRunning) {
    logger.warn('[EditAgent] Previous cycle still running — skipping')
    return false
  }
  _cycleRunning = true
  try {
    return await _runEditAgentCycleInner()
  } finally {
    _cycleRunning = false
  }
}

async function _runEditAgentCycleInner(): Promise<boolean> {
  const { vaultPath, activeVaultId } = useVaultStore.getState()
  const { editAgentConfig } = useSettingsStore.getState()
  const integrations = activeVaultId ? buildIntegrationStatus(activeVaultId) : undefined
  const store = useEditAgentStore.getState()

  if (!vaultPath || !window.vaultAPI) {
    store.addLog({ action: 'error', detail: 'No vault path — skipping cycle' })
    return false
  }

  store.setIsRunning(true)
  store.setLastWakeAt(Date.now())
  store.addLog({ action: 'wake', detail: `Wake cycle started — model: ${editAgentConfig.modelId}` })
  await appendLogToFile(vaultPath, {
    action: 'cycle_start',
    timestamp: new Date().toISOString(),
    model: editAgentConfig.modelId,
  })

  let processedCount = 0
  let editedCount = 0

  try {
    // Load vault file list
    const { files } = await window.vaultAPI.loadFiles(vaultPath)
    const mdFiles = files
      .filter(f => f.relativePath.endsWith('.md') && !f.relativePath.split('/').pop()?.startsWith('_'))
      .slice(0, MAX_FILES_PER_CYCLE)

    store.addLog({ action: 'diff_check', detail: `Scanning ${mdFiles.length} markdown files...` })

    // Populate pending queue with filenames
    const allFilenames = mdFiles.map(f => f.relativePath.split('/').pop() ?? f.relativePath)
    store.setPendingQueue(allFilenames)

    for (const file of mdFiles) {
      const filename = file.relativePath.split('/').pop() ?? file.relativePath
      const content = await window.vaultAPI.readFile(file.absolutePath)
      if (!content) {
        store.removeFromQueue(filename)
        continue
      }

      if (!needsRefinement(content)) {
        store.addLog({ action: 'file_skip', file: filename, detail: 'Recently processed — skipping' })
        store.removeFromQueue(filename)
        continue
      }

      processedCount++
      store.setProcessingFile(filename)
      store.addLog({ action: 'diff_check', file: filename, detail: 'Analyzing if improvement needed...' })

      const truncated = content.length > MAX_FILE_CHARS
        ? content.slice(0, MAX_FILE_CHARS) + '\n...(content truncated)'
        : content

      const prompt = buildRefinementPrompt(truncated, filename)

      let rawResponse = ''
      try {
        await streamMessageRaw(
          editAgentConfig.modelId,
          buildSystemPrompt(editAgentConfig.refinementManual, vaultPath, integrations),
          [{ role: 'user', content: prompt }],
          (chunk) => { rawResponse += chunk },
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        store.addLog({ action: 'error', file: filename, detail: `LLM error: ${msg}` })
        logger.warn(`[EditAgent] LLM error (${filename}):`, msg)
        continue
      }

      const result = parseRefinementResponse(rawResponse)
      if (!result) {
        store.addLog({ action: 'file_skip', file: filename, detail: 'LLM response parse failed — skipping' })
        continue
      }

      if (result.skip || !result.content) {
        store.addLog({ action: 'file_skip', file: filename, detail: result.reason || 'No improvement needed' })
        continue
      }

      // Apply edit
      const stamped = stampContent(result.content)
      const saveResult = await window.vaultAPI.saveFile(file.absolutePath, stamped)

      if (saveResult.success) {
        editedCount++
        store.addLog({ action: 'file_edit', file: filename, detail: result.reason || 'Improvement complete' })
        await appendLogToFile(vaultPath, {
          timestamp: new Date().toISOString(),
          file: filename,
          action: 'edit',
          reason: result.reason,
        })
        // Invalidate BM25 index — will be rebuilt on next search
        void invalidateTfIdfCache(vaultPath)
      } else {
        store.addLog({ action: 'error', file: filename, detail: 'File save failed' })
      }

      // Remove from pending queue after processing
      store.removeFromQueue(filename)
      store.setProcessingFile(null)
    }

    store.setPendingQueue([])
    store.setProcessingFile(null)

    // Confluence / Jira sync (if enabled in settings)
    try {
      const { runConfluenceSync, runJiraSync } = await import('@/services/syncRunner')
      if (editAgentConfig.syncConfluence && typeof runConfluenceSync === 'function') await runConfluenceSync(store)
      if (editAgentConfig.syncJira && typeof runJiraSync === 'function') await runJiraSync(store)
    } catch {
      // syncRunner may not export these functions yet — non-fatal
    }

    // Quality check (if edits were made or sync ran)
    try {
      const { runQualityCheck } = await import('@/services/syncRunner')
      if (editedCount > 0 || editAgentConfig.syncConfluence || editAgentConfig.syncJira) {
        await runQualityCheck(vaultPath, store)
      }
    } catch {
      // non-fatal
    }

    const doneMsg = `Cycle complete — processed: ${processedCount}, edited: ${editedCount}`
    store.addLog({ action: 'done', detail: doneMsg })
    await appendLogToFile(vaultPath, {
      action: 'cycle_done',
      timestamp: new Date().toISOString(),
      processed: processedCount,
      edited: editedCount,
    })
    showToast(editedCount > 0 ? `Edit Agent: ${editedCount} files improved` : 'Edit Agent: no improvements needed', 'success')
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    store.addLog({ action: 'error', detail: `Cycle error: ${msg}` })
    showToast(`Edit Agent error: ${msg}`, 'error', 5000)
    logger.error('[EditAgent] Cycle error:', err)
    return false
  } finally {
    store.setIsRunning(false)
  }
}

// ── Edit Agent Tool Definitions ───────────────────────────────────────────────

export const EDIT_AGENT_TOOLS = [
  {
    name: 'list_directory',
    description: 'Returns the file and folder list of a directory.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Absolute path to query — must start with vault path from system prompt' } },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description: 'Reads and returns file content.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Absolute path of the file to read — must start with vault path from system prompt' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Creates a file or overwrites its content completely.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute path of the file to save — must start with vault path from system prompt' },
        content: { type: 'string', description: 'Markdown content to save' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'rename_file',
    description: 'Renames a file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute path of the file to rename — must start with vault path from system prompt' },
        new_name: { type: 'string', description: 'New filename (with extension, no path)' },
      },
      required: ['path', 'new_name'],
    },
  },
  {
    name: 'delete_file',
    description: 'Deletes a file. Use with caution.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Absolute path of the file to delete — must start with vault path from system prompt' } },
      required: ['path'],
    },
  },
  {
    name: 'create_folder',
    description: 'Creates a new folder.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Absolute path of the folder to create — must start with vault path from system prompt' } },
      required: ['path'],
    },
  },
  {
    name: 'move_file',
    description: 'Moves a file to another folder.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute path of the file to move' },
        dest_folder: { type: 'string', description: 'Absolute path of the destination folder' },
      },
      required: ['path', 'dest_folder'],
    },
  },
  {
    name: 'run_python_tool',
    description: `Runs a Python script from the tools/ folder.
Available scripts: normalize_frontmatter.py, enhance_wikilinks.py, inject_keywords.py,
gen_year_hubs.py, gen_index.py, check_quality.py, check_outdated.py, check_links.py,
md_normalize.py, strengthen_links.py, split_large_docs.py, scan_cleanup.py, audit_and_fix.py,
pdf_import.py, convert_jira.py, gen_jira_index.py, crosslink_jira.py
Example args: ["/path/to/vault/active", "--verbose"]`,
    input_schema: {
      type: 'object' as const,
      properties: {
        script_name: { type: 'string', description: 'Script filename (e.g. normalize_frontmatter.py)' },
        args: { type: 'array', items: { type: 'string' }, description: 'Script argument list' },
      },
      required: ['script_name'],
    },
  },
  {
    name: 'web_search',
    description: 'Searches the web for information. DuckDuckGo-based.',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
  },
  {
    name: 'gstack',
    description: 'Controls a Playwright-based headless browser. Use snapshot to get page structure, then interact via @e3 element refs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          enum: ['goto', 'text', 'snapshot', 'click', 'fill', 'js'],
          description: 'goto: navigate URL, snapshot: accessibility tree, click: click element, fill: input value, text: get text, js: execute JS',
        },
        args: { type: 'array', items: { type: 'string' }, description: 'goto:[url], click:[@e3], fill:[@e3,value], js:[script]' },
      },
      required: ['command'],
    },
  },
  {
    name: 'confluence_import',
    description: 'Imports pages from Confluence, converts to Markdown and saves to vault. Uses configured Confluence credentials.',
    input_schema: {
      type: 'object' as const,
      properties: {
        space_key: { type: 'string', description: 'Space key (uses configured value if omitted)' },
        page_title: { type: 'string', description: 'Title search filter (all pages if omitted)' },
        max_pages: { type: 'number', description: 'Maximum page count (default 20)' },
        target_folder: { type: 'string', description: 'Save folder path (default: configured value)' },
      },
      required: [],
    },
  },
  {
    name: 'confluence_write',
    description: `Creates a new Confluence page or updates an existing one.

Workflow:
  1. mode="create": title, content(Markdown) required. space_key uses configured value if omitted.
  2. mode="update": page_id_or_url required. Fetches current version internally before updating.
  3. content is written in Markdown and automatically converted to Confluence Storage format.

Use cases:
  - Publish meeting notes, weekly reports, specs directly from vault content
  - Add new sections to existing pages (mode=update)`,
    input_schema: {
      type: 'object' as const,
      properties: {
        mode:            { type: 'string', description: '"create" (new) or "update" (modify existing). Default: "create"' },
        title:           { type: 'string', description: 'Page title' },
        content:         { type: 'string', description: 'Markdown page content (auto-converted)' },
        space_key:       { type: 'string', description: 'Confluence space key (uses configured value if omitted)' },
        parent_id:       { type: 'string', description: 'Parent page ID or URL (optional for create)' },
        page_id_or_url:  { type: 'string', description: 'Page ID or URL to modify (required for update)' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'jira_import',
    description: 'Imports issues from Jira, converts to Markdown and saves to vault. Uses configured Jira credentials.',
    input_schema: {
      type: 'object' as const,
      properties: {
        jql: { type: 'string', description: 'JQL query (uses configured value if omitted)' },
        max_issues: { type: 'number', description: 'Maximum issue count (default 50)' },
        target_folder: { type: 'string', description: 'Save folder path (default: configured value)' },
      },
      required: [],
    },
  },
  {
    name: 'pdf_import',
    description: 'Converts a PDF file to Markdown and saves it to the vault. Based on opendataloader-pdf (benchmark #1). Processes single PDF or entire folder.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pdf_path:      { type: 'string', description: 'Absolute path of the PDF file or folder to convert' },
        target_folder: { type: 'string', description: 'Folder name within vault to save (default: pdf)' },
        title:         { type: 'string', description: 'Document title — only for single PDF (defaults to PDF filename)' },
      },
      required: ['pdf_path'],
    },
  },
  {
    name: 'jira_get_members',
    description: `Fetches assignable members for the Jira project.
Check vault's jira-members.md first; use this tool when the file is missing or you need fresh data.
Returns: [{accountId, displayName, email}] — use accountId for jira_dispatch's assignee_account_id.`,
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'jira_dispatch',
    description: `Creates a new Jira issue.
Workflow:
  1. Read jira-members.md via read_file to get team member accountIds
  2. If missing, fetch via jira_get_members
  3. Create issue via jira_dispatch

Assignee uses Jira login username as assignee_account_id.
Component is read from jira-members.md component field.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        summary:             { type: 'string', description: 'Issue title' },
        description:         { type: 'string', description: 'Issue description (detailed content)' },
        assignee_account_id: { type: 'string', description: 'Assignee Jira username. Check jira-members.md or jira_get_members.' },
        issuetype_id:        { type: 'string', description: 'Issue type ID (default: 10401=Task)' },
        component:           { type: 'string', description: 'Component name. Refer to jira-members.md component field.' },
      },
      required: ['summary'],
    },
  },
  {
    name: 'jira_sprint_move',
    description: `Moves an existing Jira issue to the active sprint.
If sprint_id is not specified, automatically finds the active sprint.
Use when a jira_dispatch-created issue is not in a sprint.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        issue_key: { type: 'string', description: 'Issue key (e.g. PROJ-123)' },
        sprint_id: { type: 'number', description: 'Sprint ID (auto-detects active sprint if omitted)' },
      },
      required: ['issue_key'],
    },
  },
] as const

// ── Markdown → Confluence Storage XML ─────────────────────────────────────────

function mdToConfluenceStorage(md: string): string {
  if (!md) return ''
  const lines = md.split('\n')
  const out: string[] = []
  let inCode = false
  let codeLang = ''
  let codeLines: string[] = []

  const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inlineStyle = (s: string) =>
    s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
     .replace(/\*(.+?)\*/g, '<em>$1</em>')
     .replace(/`(.+?)`/g, '<code>$1</code>')
     .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')

  for (const raw of lines) {
    const line = raw

    // Code block open/close
    if (line.startsWith('```')) {
      if (!inCode) {
        inCode = true
        codeLang = line.slice(3).trim() || 'none'
        codeLines = []
      } else {
        inCode = false
        out.push(`<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${codeLang}</ac:parameter><ac:plain-text-body><![CDATA[${codeLines.join('\n')}]]></ac:plain-text-body></ac:structured-macro>`)
      }
      continue
    }
    if (inCode) { codeLines.push(line); continue }

    // Headings
    const hm = line.match(/^(#{1,6})\s+(.*)/)
    if (hm) { out.push(`<h${hm[1].length}>${inlineStyle(escXml(hm[2]))}</h${hm[1].length}>`); continue }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) { out.push('<hr/>'); continue }

    // Lists
    const ulm = line.match(/^(\s*)[-*]\s+(.*)/)
    if (ulm) { out.push(`<ul><li>${inlineStyle(escXml(ulm[2]))}</li></ul>`); continue }
    const olm = line.match(/^(\s*)\d+\.\s+(.*)/)
    if (olm) { out.push(`<ol><li>${inlineStyle(escXml(olm[2]))}</li></ol>`); continue }

    // Empty line
    if (line.trim() === '') { out.push(''); continue }

    // Normal paragraph
    out.push(`<p>${inlineStyle(escXml(line))}</p>`)
  }
  return out.join('\n')
}

// ── HTML → Markdown (for Confluence API responses) ───────────────────────────

function htmlToMarkdown(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, nav').forEach(el => el.remove())

  function processNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    const children = Array.from(el.childNodes).map(processNode).join('')
    switch (tag) {
      case 'h1': return `# ${children}\n\n`
      case 'h2': return `## ${children}\n\n`
      case 'h3': return `### ${children}\n\n`
      case 'h4': return `#### ${children}\n\n`
      case 'p': return `${children}\n\n`
      case 'br': return '\n'
      case 'strong': case 'b': return `**${children}**`
      case 'em': case 'i': return `*${children}*`
      case 'code': return `\`${children}\``
      case 'pre': return `\`\`\`\n${children}\n\`\`\`\n\n`
      case 'ul': case 'ol': return children + '\n'
      case 'li': return `- ${children.trim()}\n`
      case 'a': return `[${children}](${el.getAttribute('href') ?? ''})`
      case 'hr': return '---\n\n'
      case 'blockquote': return `> ${children}\n\n`
      case 'th': return `| **${children.trim()}** `
      case 'td': return `| ${children.trim()} `
      case 'tr': return children + '|\n'
      case 'table': return children + '\n'
      default: return children
    }
  }
  return processNode(doc.body).replace(/\n{3,}/g, '\n\n').trim()
}

// ── Path safety ───────────────────────────────────────────────────────────────

function isInsideVault(targetPath: string, vaultPath: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const t = norm(targetPath)
  const v = norm(vaultPath)
  return t === v || t.startsWith(v + '/')
}

// ── Tool Executor ─────────────────────────────────────────────────────────────

export async function executeAgentTool(
  name: string,
  input: Record<string, unknown>,
  vaultPath: string,
): Promise<string> {
  // Path traversal guard for file-system tools
  const FILE_TOOLS = new Set(['list_directory', 'read_file', 'write_file', 'rename_file', 'delete_file', 'create_folder', 'move_file'])
  if (FILE_TOOLS.has(name) && typeof input.path === 'string') {
    if (!isInsideVault(input.path, vaultPath)) {
      return `Error: access to path outside vault blocked — ${input.path}`
    }
  }

  try {
    switch (name) {
      case 'list_directory': {
        const result = await window.vaultAPI?.loadFiles(input.path as string)
        if (!result) return 'Error: vaultAPI unavailable'
        const lines = [
          ...result.folders.map((f: string) => `[folder] ${f}`),
          ...result.files.map((f: { relativePath: string; absolutePath?: string }) =>
            `[file] ${f.relativePath}${f.absolutePath ? ` -> ${f.absolutePath}` : ''}`),
        ]
        return lines.join('\n') || '(empty)'
      }
      case 'read_file': {
        const content = await window.vaultAPI?.readFile(input.path as string)
        return content ?? 'Error: unable to read file'
      }
      case 'write_file': {
        const r = await window.vaultAPI?.saveFile(input.path as string, input.content as string)
        return r?.success ? `Save complete: ${r.path}` : 'Save failed'
      }
      case 'rename_file': {
        const r = await window.vaultAPI?.renameFile(input.path as string, input.new_name as string)
        return r?.success ? `Rename complete: ${r.newPath}` : 'Rename failed'
      }
      case 'delete_file': {
        const r = await window.vaultAPI?.deleteFile(input.path as string)
        return r?.success ? 'Delete complete' : 'Delete failed'
      }
      case 'create_folder': {
        const r = await window.vaultAPI?.createFolder(input.path as string)
        return r?.success ? `Folder created: ${r.path}` : 'Folder creation failed'
      }
      case 'move_file': {
        const r = await window.vaultAPI?.moveFile(input.path as string, input.dest_folder as string)
        return r?.success ? `Move complete: ${r.newPath}` : 'Move failed'
      }
      case 'run_python_tool': {
        const toolsAPI = window.toolsAPI
        if (!toolsAPI) return 'Error: toolsAPI unavailable (Electron only)'
        const r = await toolsAPI.runVaultTool(
          input.script_name as string,
          (input.args as string[] | undefined) ?? [],
        )
        const out = [r.stdout?.trim(), r.stderr?.trim()].filter(Boolean).join('\n')
        return `exitCode: ${r.exitCode}\n${out || '(no output)'}`
      }
      case 'web_search': {
        const html = await window.webSearchAPI?.search(input.query as string) ?? ''
        // Strip HTML tags and collapse whitespace
        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000) || 'No results'
      }
      case 'gstack': {
        const { gstackExecute } = await import('@/services/computerUse')
        const cmd = input.command as 'goto' | 'text' | 'snapshot' | 'click' | 'fill' | 'js'
        const args = (input.args as string[] | undefined) ?? []
        const r = await gstackExecute(cmd, args)
        return r.success ? r.output : `Error: ${r.error}`
      }

      case 'confluence_import': {
        const { activeVaultId } = useVaultStore.getState()
        const { confluenceConfigs } = useSettingsStore.getState()
        const cfg = confluenceConfigs[activeVaultId] ?? confluenceConfigs['__migrated__']
        if (!cfg?.baseUrl) return 'Error: Confluence not configured — check Settings > Confluence'
        if (!window.confluenceAPI) return 'Error: confluenceAPI unavailable (Electron only)'
        const spaceKey = (input.space_key as string | undefined) || cfg.spaceKey || ''
        if (!spaceKey) return 'Error: No Space Key — set it in Settings > Confluence'
        const maxPages = (input.max_pages as number | undefined) ?? 20
        const targetFolder = (input.target_folder as string | undefined) ?? cfg.targetFolder ?? 'confluence'
        // IPC route — Electron net.fetch (no CORS)
        const pages: Array<Record<string, unknown>> = await window.confluenceAPI.fetchPages({
          baseUrl: cfg.baseUrl, authType: cfg.authType, email: cfg.email,
          apiToken: cfg.apiToken, spaceKey, bypassSSL: cfg.bypassSSL,
          dateFrom: cfg.dateFrom || '2025-01-01',
        })
        const filtered = (input.page_title as string | undefined)
          ? pages.filter(p => String(p['title'] ?? '').toLowerCase().includes((input.page_title as string).toLowerCase()))
          : pages
        const toProcess = filtered.slice(0, maxPages)
        const results: string[] = []
        for (const page of toProcess) {
          try {
            const title = String(page['title'] ?? '')
            const history = page['history'] as Record<string, unknown> | undefined
            const lastUpdated = history?.['lastUpdated'] as Record<string, string> | undefined
            const created = String(history?.['createdDate'] ?? '').split('T')[0]
            const modified = String(lastUpdated?.['when'] ?? '').split('T')[0]
            const body = page['body'] as Record<string, unknown> | undefined
            const viewHtml = (body?.['view'] as Record<string, string> | undefined)?.['value'] ?? ''
            const md = htmlToMarkdown(viewHtml)
            const fm = `---\ntitle: "${title.replace(/"/g, "'")}"\ncreated: ${created}\nmodified: ${modified}\nsource: confluence\ntags: [confluence]\n---\n\n`
            const filename = title.replace(/[<>:"/\\|?*]/g, '_') + '.md'
            const r = await window.vaultAPI?.saveFile(`${vaultPath}/${targetFolder}/${filename}`, fm + md)
            results.push(r?.success ? `OK ${filename}` : `FAIL ${filename} (save failed)`)
          } catch (e) {
            results.push(`FAIL ${page['title']}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
        return `Confluence import complete (${results.length})\n${results.join('\n')}`
      }

      case 'confluence_write': {
        const { activeVaultId } = useVaultStore.getState()
        const { confluenceConfigs } = useSettingsStore.getState()
        const cfg = confluenceConfigs[activeVaultId] ?? confluenceConfigs['__migrated__']
        if (!cfg?.baseUrl || !cfg?.apiToken) return 'Error: Confluence not configured — check Settings > Confluence'
        if (!window.confluenceAPI) return 'Error: confluenceAPI unavailable (Electron only)'

        const mode = (input.mode as string) || 'create'
        const title = input.title as string
        const markdown = input.content as string
        const storageBody = mdToConfluenceStorage(markdown)
        const confCfg = {
          baseUrl: cfg.baseUrl, authType: cfg.authType, email: cfg.email,
          apiToken: cfg.apiToken, spaceKey: cfg.spaceKey, bypassSSL: cfg.bypassSSL,
        }

        if (mode === 'update') {
          const pageIdOrUrl = input.page_id_or_url as string
          if (!pageIdOrUrl) return 'Error: page_id_or_url required for mode=update'
          const info = await window.confluenceAPI.getPageInfo(confCfg, pageIdOrUrl)
          const result = await window.confluenceAPI.updatePage(confCfg, {
            pageId: info.id, title, storageBody, currentVersion: info.version,
          })
          return `Confluence page updated: ${title} — ${result.url}`
        } else {
          const result = await window.confluenceAPI.createPage(confCfg, {
            title, storageBody,
            spaceKey: (input.space_key as string) || cfg.spaceKey,
            parentId: (input.parent_id as string) || undefined,
          })
          return `Confluence page created: ${title} — ${result.url}`
        }
      }

      case 'jira_import': {
        const { activeVaultId } = useVaultStore.getState()
        const { jiraConfigs } = useSettingsStore.getState()
        const cfg = jiraConfigs[activeVaultId]
        if (!cfg?.baseUrl) return 'Error: Jira not configured — check Settings > Jira'
        if (!window.jiraAPI) return 'Error: jiraAPI unavailable (Electron only)'
        const jql = (input.jql as string | undefined) || cfg.jql || (cfg.projectKey ? `project = ${cfg.projectKey}` : '')
        if (!jql) return 'Error: No JQL query — provide jql parameter or set projectKey/jql in settings'
        const maxIssues = (input.max_issues as number | undefined) ?? 50
        const targetFolder = (input.target_folder as string | undefined) ?? cfg.targetFolder ?? 'jira'
        // IPC route — Electron net.fetch (no CORS)
        const issues: Array<Record<string, unknown>> = await window.jiraAPI.fetchIssues({
          baseUrl: cfg.baseUrl, authType: cfg.authType, email: cfg.email,
          apiToken: cfg.apiToken, projectKey: cfg.projectKey, jql,
          bypassSSL: cfg.bypassSSL, dateFrom: cfg.dateFrom || '2025-01-01',
        })
        const data = { issues: issues.slice(0, maxIssues), total: issues.length }
        const results: string[] = []
        for (const issue of data.issues) {
          const f = issue['fields'] as Record<string, unknown>
          const key = String(issue['key'])
          const summary = String(f['summary'] ?? '')
          const status = (f['status'] as Record<string, string> | undefined)?.['name'] ?? ''
          const assignee = (f['assignee'] as Record<string, string> | undefined)?.['displayName'] ?? ''
          const priority = (f['priority'] as Record<string, string> | undefined)?.['name'] ?? ''
          const issueType = (f['issuetype'] as Record<string, string> | undefined)?.['name'] ?? ''
          const created = String(f['created'] ?? '').split('T')[0]
          const updated = String(f['updated'] ?? '').split('T')[0]
          const labels = (f['labels'] as string[] | undefined) ?? []
          const description = String(f['description'] ?? '')
          const fm = [
            '---',
            `title: "${key}: ${summary.replace(/"/g, "'")}"`,
            `jira_key: ${key}`, `status: ${status}`, `type: ${issueType}`,
            `priority: ${priority}`, assignee ? `assignee: ${assignee}` : '',
            `created: ${created}`, `modified: ${updated}`,
            `tags: [jira${labels.map(l => `, ${l}`).join('')}]`, 'source: jira', '---', '',
          ].filter(Boolean).join('\n')
          const body = `# ${key}: ${summary}\n\n**Status**: ${status} | **Type**: ${issueType} | **Priority**: ${priority}\n\n`
            + (description ? `## Description\n\n${description}\n` : '')
          const filename = `${key} ${summary.replace(/[<>:"/\\|?*]/g, '_').slice(0, 60)}.md`
          try {
            const r = await window.vaultAPI?.saveFile(`${vaultPath}/${targetFolder}/${filename}`, fm + body)
            results.push(r?.success ? `OK ${key}` : `FAIL ${key} (save failed)`)
          } catch (e) {
            results.push(`FAIL ${key}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
        return `Jira import complete — ${results.length} of ${data.total} processed\n${results.join('\n')}`
      }

      case 'jira_get_members': {
        const { activeVaultId } = useVaultStore.getState()
        const { jiraConfigs } = useSettingsStore.getState()
        const cfg = jiraConfigs[activeVaultId] ?? jiraConfigs['__migrated__']
        if (!cfg?.baseUrl || !cfg?.apiToken) return 'Error: Jira not configured — check Settings > Jira'
        if (!window.jiraAPI) return 'Error: jiraAPI unavailable (Electron only)'
        const members = await window.jiraAPI.getMembers({
          baseUrl: cfg.baseUrl, authType: cfg.authType, email: cfg.email,
          apiToken: cfg.apiToken, projectKey: cfg.projectKey, bypassSSL: cfg.bypassSSL,
        })
        return JSON.stringify(members, null, 2)
      }

      case 'jira_dispatch': {
        const { activeVaultId } = useVaultStore.getState()
        const { jiraConfigs } = useSettingsStore.getState()
        const cfg = jiraConfigs[activeVaultId] ?? jiraConfigs['__migrated__']
        if (!cfg?.baseUrl || !cfg?.apiToken) return 'Error: Jira not configured — check Settings > Jira'
        if (!window.jiraAPI) return 'Error: jiraAPI unavailable (Electron only)'
        const result = await window.jiraAPI.createIssue(
          {
            baseUrl: cfg.baseUrl, authType: cfg.authType, email: cfg.email,
            apiToken: cfg.apiToken, projectKey: cfg.projectKey, bypassSSL: cfg.bypassSSL,
          },
          {
            summary: input.summary as string,
            description: (input.description as string) ?? '',
            issuetype: (input.issuetype_id as string) || '10401',
            assigneeAccountId: (input.assignee_account_id as string) || undefined,
            component: (input.component as string) || undefined,
          },
        )
        return `Jira issue created: ${result.key} — ${result.url}`
      }

      case 'jira_sprint_move': {
        const { activeVaultId } = useVaultStore.getState()
        const { jiraConfigs } = useSettingsStore.getState()
        const cfg = jiraConfigs[activeVaultId] ?? jiraConfigs['__migrated__']
        if (!cfg?.baseUrl || !cfg?.apiToken) return 'Error: Jira not configured — check Settings > Jira'
        const issueKey = input.issue_key as string
        if (!issueKey) return 'Error: issue_key required'

        const base = cfg.baseUrl.replace(/\/+$/, '')
        const authType = cfg.authType ?? 'server_basic'
        const authHeader = authType === 'server_pat'
          ? `Bearer ${cfg.apiToken}`
          : 'Basic ' + btoa(`${cfg.email}:${cfg.apiToken}`)
        const headers = { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json' }
        const agileBase = `${base}/rest/agile/1.0`

        let sprintId = input.sprint_id as number | undefined
        if (!sprintId) {
          const boardId = (cfg as unknown as Record<string, unknown>).boardId as number | undefined
          let resolvedBoardId = boardId
          if (!resolvedBoardId) {
            const boardRes = await fetch(`${agileBase}/board?projectKeyOrId=${encodeURIComponent(cfg.projectKey)}&type=scrum&maxResults=10`, { headers })
            if (boardRes.ok) {
              const bd = await boardRes.json() as { values?: { id: number }[] }
              resolvedBoardId = bd?.values?.[0]?.id
            }
          }
          if (resolvedBoardId) {
            const sprintRes = await fetch(`${agileBase}/board/${resolvedBoardId}/sprint?state=active&maxResults=1`, { headers })
            if (sprintRes.ok) {
              const sd = await sprintRes.json() as { values?: { id: number }[] }
              sprintId = sd?.values?.[0]?.id
            }
          }
        }
        if (!sprintId) return 'Error: could not find active sprint'

        const res = await fetch(`${agileBase}/sprint/${sprintId}/issue`, {
          method: 'POST', headers, body: JSON.stringify({ issues: [issueKey] }),
        })
        if (!res.ok && res.status !== 204) return `Error: Sprint move failed (${res.status})`
        return `Sprint assignment complete: ${issueKey} -> sprint ${sprintId}`
      }

      case 'pdf_import': {
        const pdfPath     = input.pdf_path as string | undefined
        const targetFolder = (input.target_folder as string | undefined) ?? 'pdf'
        const title        = (input.title as string | undefined) ?? ''
        if (!pdfPath) return 'Error: pdf_path parameter is required'
        if (!window.toolsAPI) return 'Error: toolsAPI unavailable (Electron only)'
        const outputDir = `${vaultPath}/${targetFolder}`
        const scriptArgs = [pdfPath, outputDir]
        if (title) scriptArgs.push('--title', title)
        const r = await window.toolsAPI.runVaultTool('pdf_import.py', scriptArgs)
        if (r.exitCode !== 0) return `PDF conversion failed:\n${r.stderr || r.stdout}`
        return r.stdout || 'PDF conversion complete'
      }

      default:
        return `Error: unknown tool: ${name}`
    }
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ── Anthropic API call with 429 retry ─────────────────────────────────────────

const MAX_RETRIES = 4

async function fetchAnthropicWithRetry(
  url: string,
  init: RequestInit,
  onWait?: (seconds: number, attempt: number) => void,
): Promise<Response> {
  let attempt = 0
  while (true) {
    const response = await fetch(url, init)
    if (response.status !== 429 || attempt >= MAX_RETRIES) return response

    // Read retry-after header (seconds), fall back to exponential backoff
    const retryAfter = response.headers.get('retry-after')
    const waitSec = retryAfter ? Math.min(parseInt(retryAfter, 10) || 10, 60) : Math.min(4 ** attempt, 60)
    onWait?.(waitSec, attempt + 1)
    await new Promise(res => setTimeout(res, waitSec * 1000))
    attempt++
  }
}

// ── Agent message types ───────────────────────────────────────────────────────

type TextBlock   = { type: 'text'; text: string }
type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
type ContentBlock = TextBlock | ToolUseBlock
type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string }
type AgentMsg =
  | { role: 'user'; content: string | ToolResultBlock[] }
  | { role: 'assistant'; content: ContentBlock[] }

/**
 * Send a direct chat message to the edit agent.
 * Uses Anthropic tool use API with a full agentic loop.
 * All vault tools, Python scripts, web search, and gstack are available.
 */
export async function sendEditAgentChatMessage(userMessage: string): Promise<void> {
  const { editAgentConfig } = useSettingsStore.getState()
  const { vaultPath, activeVaultId } = useVaultStore.getState()
  const integrations = activeVaultId ? buildIntegrationStatus(activeVaultId) : undefined
  const store = useEditAgentStore.getState()
  const apiKey = getApiKey('anthropic')

  // Conversation history snapshot (before adding new message) — user/agent turns only, last 10
  const historyMsgs = store.messages
    .filter(m => m.role === 'user' || m.role === 'agent')
    .slice(-10)
  // For Anthropic tool-use API (AgentMsg format)
  const historyForApi: AgentMsg[] = historyMsgs.map(m =>
    m.role === 'agent'
      ? { role: 'assistant' as const, content: [{ type: 'text' as const, text: m.content }] }
      : { role: 'user' as const, content: m.content }
  )
  // For streamMessageRaw fallback (plain string content)
  const historyForRaw: { role: 'user' | 'assistant'; content: string }[] = historyMsgs.map(m => ({
    role: (m.role === 'agent' ? 'assistant' : 'user') as 'user' | 'assistant',
    content: m.content,
  }))

  store.addMessage({ role: 'user', content: userMessage })
  const msgId = store.beginAgentStream()

  // No Anthropic API key — fall back to plain streaming (no tools)
  if (!apiKey) {
    try {
      await streamMessageRaw(
        editAgentConfig.modelId,
        buildSystemPrompt(editAgentConfig.refinementManual, vaultPath, integrations),
        [...historyForRaw, { role: 'user' as const, content: userMessage }],
        (chunk) => { useEditAgentStore.getState().appendStreamChunk(msgId, chunk) },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      useEditAgentStore.getState().appendStreamChunk(msgId, `\n\n[Error: ${msg}]`)
    } finally {
      useEditAgentStore.getState().endAgentStream(msgId)
    }
    return
  }

  const systemPrompt = buildSystemPrompt(editAgentConfig.refinementManual, vaultPath, integrations)

  const messages: AgentMsg[] = [...historyForApi, { role: 'user', content: userMessage }]
  const MAX_ITERATIONS = 30

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const response = await fetchAnthropicWithRetry(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: editAgentConfig.modelId,
            max_tokens: AGENT_MAX_OUTPUT_TOKENS,
            system: systemPrompt,
            tools: EDIT_AGENT_TOOLS,
            messages,
          }),
        },
        (seconds, attempt) => {
          useEditAgentStore.getState().appendStreamChunk(
            msgId, `\n\nAPI rate limit exceeded — retrying in ${seconds}s (${attempt}/${MAX_RETRIES})...`,
          )
        },
      )

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Anthropic API error ${response.status}: ${errText}`)
      }

      const data = await response.json() as {
        content: ContentBlock[]
        stop_reason: 'end_turn' | 'tool_use' | 'max_tokens'
        usage: { input_tokens: number; output_tokens: number }
      }

      // Track usage
      if (data.usage) {
        useUsageStore.getState().recordUsage(
          editAgentConfig.modelId, data.usage.input_tokens, data.usage.output_tokens, 'editAgent',
        )
      }

      // Add assistant turn to history
      messages.push({ role: 'assistant', content: data.content })

      // Stream text blocks
      for (const block of data.content) {
        if (block.type === 'text' && block.text) {
          useEditAgentStore.getState().appendStreamChunk(msgId, block.text)
        }
      }

      if (data.stop_reason === 'end_turn' || data.stop_reason === 'max_tokens') break

      if (data.stop_reason === 'tool_use') {
        const toolResults: ToolResultBlock[] = []
        const toolBlocks = data.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
        const groupItems: { name: string; input: unknown; result: string }[] = []

        for (const block of toolBlocks) {
          const result = await executeAgentTool(block.name, block.input, vaultPath ?? '')
          groupItems.push({ name: block.name, input: block.input, result })
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
        }

        // If multiple tool calls in one turn -> show as one grouped summary card
        if (groupItems.length > 1) {
          useEditAgentStore.getState().addToolCallGroup(groupItems)
        } else if (groupItems.length === 1) {
          const { name, input, result } = groupItems[0]
          useEditAgentStore.getState().addToolCall(name, input, result)
        }

        messages.push({ role: 'user', content: toolResults })
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    useEditAgentStore.getState().appendStreamChunk(msgId, `\n\n[Error: ${msg}]`)
    logger.error('[EditAgent] chat error:', err)
  } finally {
    useEditAgentStore.getState().endAgentStream(msgId)
  }
}
