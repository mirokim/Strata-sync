/**
 * MCP Server — registers all tools and resources for Strata Sync.
 * 33 tools: vault CRUD, graph analysis, chat, search, edit agent, debate,
 * python tools, confluence/jira sync, slack bot, usage tracking, settings.
 */
import https from 'node:https'
import http from 'node:http'
import crypto from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { getConfig, updateConfig, loadConfig } from './config.js'
import { listFiles, readFile, saveFile, deleteFile, renameFile, createFolder, moveFile } from './vault.js'
import {
  reloadVault, bm25Search, hybridSearch, buildVectorIndex, getVectorIndexStats,
  getDocuments, getNodes, getLinks,
  computePageRank, detectClusters, findBridgeNodes, findImplicitLinks,
} from './state.js'
import { chat, chatWithPersona, getUsageSummary, getUsageLog } from './llm/client.js'
import { join, resolve, normalize } from 'path'

/** External API call timeout (30 s) — prevents fetch from hanging on slow/down servers */
const EXT_TIMEOUT_MS = 30_000

// ── Helpers ─────────────────────────────────────────────────────────────────

function ok(data: unknown) { return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] } }
function err(msg: string) { return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true as const } }

function safeVaultPath(relativePath: string): string | null {
  const vaultPath = getConfig().vaultPath
  if (!vaultPath) return null
  const abs = resolve(vaultPath, relativePath)
  const norm = normalize(abs).replace(/\\/g, '/')
  const vaultNorm = normalize(vaultPath).replace(/\\/g, '/').replace(/\/$/, '')
  // Require a path separator after the vault root to prevent sibling-dir traversal
  // e.g. vaultNorm="/foo/vault" must not match "/foo/vault-other/file"
  if (norm !== vaultNorm && !norm.startsWith(vaultNorm + '/')) return null
  return abs
}

// ── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  // ─── Vault CRUD ───
  { name: 'vault_reload', description: 'Reload vault documents, rebuild graph and BM25 index', inputSchema: { type: 'object' as const, properties: {} } },
  { name: 'vault_list', description: 'List all files and folders in the vault', inputSchema: { type: 'object' as const, properties: { folder: { type: 'string', description: 'Optional subfolder to list' } } } },
  { name: 'vault_read', description: 'Read a file from the vault', inputSchema: { type: 'object' as const, properties: { path: { type: 'string', description: 'Relative path within vault' } }, required: ['path'] } },
  { name: 'vault_write', description: 'Write/create a file in the vault', inputSchema: { type: 'object' as const, properties: { path: { type: 'string', description: 'Relative path within vault' }, content: { type: 'string', description: 'File content' } }, required: ['path', 'content'] } },
  { name: 'vault_delete', description: 'Delete a file from the vault', inputSchema: { type: 'object' as const, properties: { path: { type: 'string', description: 'Relative path within vault' } }, required: ['path'] } },
  { name: 'vault_rename', description: 'Rename a file in the vault', inputSchema: { type: 'object' as const, properties: { path: { type: 'string', description: 'Current relative path' }, newName: { type: 'string', description: 'New filename (not full path)' } }, required: ['path', 'newName'] } },
  { name: 'vault_move', description: 'Move a file to a different folder in the vault', inputSchema: { type: 'object' as const, properties: { path: { type: 'string', description: 'Current relative path' }, destFolder: { type: 'string', description: 'Destination folder relative path' } }, required: ['path', 'destFolder'] } },
  { name: 'vault_mkdir', description: 'Create a folder in the vault', inputSchema: { type: 'object' as const, properties: { folder: { type: 'string', description: 'Folder relative path to create' } }, required: ['folder'] } },

  // ─── Search ───
  { name: 'search_bm25', description: 'BM25 full-text search across vault documents', inputSchema: { type: 'object' as const, properties: { query: { type: 'string' }, topK: { type: 'number', description: 'Max results (default 10)' } }, required: ['query'] } },
  { name: 'vector_build', description: 'Build or update the vector embedding index (OpenAI text-embedding-3-small). Run once after vault_reload to enable hybrid search.', inputSchema: { type: 'object' as const, properties: {} } },
  { name: 'search_tags', description: 'Find documents by tag', inputSchema: { type: 'object' as const, properties: { tag: { type: 'string' } }, required: ['tag'] } },
  { name: 'search_speaker', description: 'Find documents by speaker/persona', inputSchema: { type: 'object' as const, properties: { speaker: { type: 'string' } }, required: ['speaker'] } },

  // ─── Graph Analysis ───
  { name: 'graph_stats', description: 'Get graph statistics (node count, link count, clusters)', inputSchema: { type: 'object' as const, properties: {} } },
  { name: 'graph_pagerank', description: 'Compute PageRank — find most important documents', inputSchema: { type: 'object' as const, properties: { topK: { type: 'number', description: 'Top N results (default 20)' } } } },
  { name: 'graph_clusters', description: 'Detect document clusters (connected components)', inputSchema: { type: 'object' as const, properties: {} } },
  { name: 'graph_bridges', description: 'Find bridge nodes connecting multiple clusters', inputSchema: { type: 'object' as const, properties: { topK: { type: 'number', description: 'Top N (default 10)' } } } },
  { name: 'graph_implicit_links', description: 'Find implicit links via BM25 cosine similarity', inputSchema: { type: 'object' as const, properties: { minScore: { type: 'number' }, topK: { type: 'number' } } } },
  { name: 'graph_neighbors', description: 'Get direct neighbors of a document', inputSchema: { type: 'object' as const, properties: { docId: { type: 'string' } }, required: ['docId'] } },

  // ─── Chat / LLM ───
  { name: 'chat', description: 'Chat with any LLM model (raw)', inputSchema: { type: 'object' as const, properties: { model: { type: 'string', description: 'Model ID (e.g. claude-sonnet-4-6)' }, system: { type: 'string', description: 'System prompt' }, messages: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } }, description: 'Message history' } }, required: ['model', 'messages'] } },
  { name: 'chat_persona', description: 'Chat with a director persona (with project context + RAG)', inputSchema: { type: 'object' as const, properties: { persona: { type: 'string', description: 'Persona ID (chief_director, art_director, etc.)' }, message: { type: 'string' }, history: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } } }, useRag: { type: 'boolean', description: 'Auto-search vault for context (default true)' } }, required: ['persona', 'message'] } },

  // ─── Edit Agent ───
  { name: 'edit_agent_refine', description: 'Run Edit Agent to refine a document based on instructions', inputSchema: { type: 'object' as const, properties: { path: { type: 'string', description: 'Relative path to the document' }, instructions: { type: 'string', description: 'Refinement instructions' }, model: { type: 'string', description: 'Override model (optional)' } }, required: ['path', 'instructions'] } },

  // ─── Debate (MiroFish) ───
  { name: 'debate_start', description: 'Start a multi-persona debate on a topic', inputSchema: { type: 'object' as const, properties: { topic: { type: 'string' }, personas: { type: 'array', items: { type: 'string' }, description: 'List of persona IDs to participate' }, rounds: { type: 'number', description: 'Number of debate rounds (default 3)' } }, required: ['topic'] } },

  // ─── Python Tools ───
  { name: 'python_run', description: 'Run a Python tool script from the tools/ directory', inputSchema: { type: 'object' as const, properties: { script: { type: 'string', description: 'Script name (e.g. check_quality.py)' }, args: { type: 'array', items: { type: 'string' }, description: 'Command-line arguments' } }, required: ['script'] } },
  { name: 'jira_crosslink', description: 'Jira ↔ Active 볼트 교차 wikilink를 자동 주입합니다. Jira 이슈와 Confluence 문서를 의미 기반으로 연결합니다.', inputSchema: { type: 'object' as const, properties: { dry_run: { type: 'boolean', description: '미리보기만 (기본 true). false이면 실제 파일 수정.' } } } },

  // ─── Confluence / Jira Sync ───
  { name: 'confluence_sync', description: 'Sync pages from Confluence to vault', inputSchema: { type: 'object' as const, properties: { spaceKey: { type: 'string', description: 'Override space key (optional)' }, dateFrom: { type: 'string', description: 'Override date filter (optional)' } } } },
  { name: 'jira_sync', description: 'Sync issues from Jira to vault', inputSchema: { type: 'object' as const, properties: { projectKey: { type: 'string', description: 'Override project key (optional)' }, jql: { type: 'string', description: 'Override JQL (optional)' } } } },
  { name: 'jira_create_issue', description: 'Create a new Jira issue and optionally assign to a team member', inputSchema: { type: 'object' as const, properties: { summary: { type: 'string', description: '이슈 제목' }, description: { type: 'string', description: '이슈 설명' }, issuetype: { type: 'string', description: 'Task | Story | Bug | Sub-task (default: Task)' }, assigneeAccountId: { type: 'string', description: '담당자 Jira accountId' }, components: { type: 'array', items: { type: 'string' }, description: '컴포넌트 이름 목록 (예: ["[V1_아트실] 원화파트", "[V1_기획실]"]). jira-members.md의 component 필드 참조.' }, priority: { type: 'string', description: 'Highest | High | Medium | Low | Lowest (default: Medium)' }, labels: { type: 'array', items: { type: 'string' }, description: '레이블 목록' }, parentKey: { type: 'string', description: '상위 Epic/Story 키 (선택)' } }, required: ['summary'] } },
  { name: 'jira_transition', description: 'Jira 이슈 상태를 전환합니다 (예: To Do → In Progress → Done)', inputSchema: { type: 'object' as const, properties: { issue_key: { type: 'string', description: '이슈 키 (예: PROJ-123)' }, transition_name: { type: 'string', description: '전환할 상태 이름 (예: "In Progress", "Done"). list_only=true이면 이 필드 불필요.' }, list_only: { type: 'boolean', description: 'true이면 전환 목록만 반환' } }, required: ['issue_key'] } },
  { name: 'jira_get_members', description: 'Get assignable members for the Jira project (with accountId)', inputSchema: { type: 'object' as const, properties: { projectKey: { type: 'string', description: 'Override project key (optional)' } } } },
  { name: 'jira_sprint_move', description: '기존 Jira 이슈를 활성 스프린트(또는 지정 스프린트)로 이동합니다', inputSchema: { type: 'object' as const, properties: { issue_key: { type: 'string', description: '이슈 키 (예: SGEATF-11862)' }, sprint_id: { type: 'number', description: '스프린트 ID (미지정 시 활성 스프린트 자동 탐색)' } }, required: ['issue_key'] } },

  // ─── Confluence Write ───
  { name: 'confluence_write_page', description: 'Create or update a Confluence page with Markdown content', inputSchema: { type: 'object' as const, properties: { mode: { type: 'string', description: '"create" (new page) or "update" (existing page)' }, pageId: { type: 'string', description: 'Required for update mode — target page ID' }, title: { type: 'string', description: 'Page title' }, markdownContent: { type: 'string', description: 'Markdown content to publish' }, spaceKey: { type: 'string', description: 'Space key (create mode, optional — uses config default)' }, parentId: { type: 'string', description: 'Parent page ID (create mode, optional)' } }, required: ['mode', 'title', 'markdownContent'] } },

  // ─── Slack Bot ───
  { name: 'slack_send', description: 'Send a message to a Slack channel', inputSchema: { type: 'object' as const, properties: { channel: { type: 'string' }, text: { type: 'string' } }, required: ['channel', 'text'] } },

  // ─── Usage Tracking ───
  { name: 'usage_summary', description: 'Get LLM usage summary (total tokens, cost)', inputSchema: { type: 'object' as const, properties: {} } },
  { name: 'usage_log', description: 'Get detailed usage log entries', inputSchema: { type: 'object' as const, properties: { limit: { type: 'number', description: 'Max entries (default 100)' } } } },

  // ─── Settings ───
  { name: 'settings_get', description: 'Get current MCP server settings', inputSchema: { type: 'object' as const, properties: {} } },
  { name: 'settings_update', description: 'Update MCP server settings', inputSchema: { type: 'object' as const, properties: { updates: { type: 'object', description: 'Partial config object to merge' } }, required: ['updates'] } },
]

// ── Tool handlers ───────────────────────────────────────────────────────────

type Args = Record<string, unknown>
type ToolResult = { content: { type: 'text'; text: string }[]; isError?: true }

async function handleTool(name: string, args: Args): Promise<ToolResult> {
  const config = getConfig()
  const vaultPath = config.vaultPath

  switch (name) {
    // ─── Vault CRUD ───
    case 'vault_reload': {
      if (!vaultPath) return err('vaultPath not configured')
      const stats = await reloadVault(vaultPath)
      return ok({ message: 'Vault reloaded', ...stats })
    }
    case 'vault_list': {
      if (!vaultPath) return err('vaultPath not configured')
      const result = listFiles(vaultPath, args.folder as string | undefined)
      return ok({ fileCount: result.files.length, folderCount: result.folders.length, files: result.files.map(f => f.relativePath), folders: result.folders })
    }
    case 'vault_read': {
      const abs = safeVaultPath(args.path as string)
      if (!abs) return err('Invalid path or vault not configured')
      const content = readFile(abs)
      if (content === null) return err(`File not found: ${args.path}`)
      return ok({ path: args.path, content })
    }
    case 'vault_write': {
      const abs = safeVaultPath(args.path as string)
      if (!abs) return err('Invalid path or vault not configured')
      const result = saveFile(abs, args.content as string)
      return ok(result)
    }
    case 'vault_delete': {
      const abs = safeVaultPath(args.path as string)
      if (!abs) return err('Invalid path or vault not configured')
      return ok(deleteFile(abs))
    }
    case 'vault_rename': {
      const abs = safeVaultPath(args.path as string)
      if (!abs) return err('Invalid path or vault not configured')
      return ok(renameFile(abs, args.newName as string))
    }
    case 'vault_move': {
      const abs = safeVaultPath(args.path as string)
      const destAbs = safeVaultPath(args.destFolder as string)
      if (!abs || !destAbs) return err('Invalid path or vault not configured')
      return ok(moveFile(abs, destAbs))
    }
    case 'vault_mkdir': {
      const abs = safeVaultPath(args.folder as string)
      if (!abs) return err('Invalid path or vault not configured')
      return ok(createFolder(abs))
    }

    // ─── Search ───
    case 'search_bm25': {
      const query = String(args.query ?? '').trim().slice(0, 500)
      if (!query) return err('query is required')
      const results = bm25Search(query, Math.min((args.topK as number) ?? 10, 100))
      return ok(results)
    }
    case 'vector_build': {
      const stats = getVectorIndexStats()
      if (!getConfig().apiKeys['gemini']) return err('Gemini API key not configured (apiKeys.gemini)')
      const result = await buildVectorIndex()
      return ok({ ...result, totalIndexed: stats.indexed + (result.embedded ?? 0), total: stats.total })
    }
    case 'search_tags': {
      const tag = String(args.tag ?? '').trim().slice(0, 200).toLowerCase()
      const docs = getDocuments().filter(d => d.tags.some(t => t.toLowerCase() === tag))
      return ok(docs.map(d => ({ id: d.id, filename: d.filename, tags: d.tags, speaker: d.speaker })))
    }
    case 'search_speaker': {
      const speaker = String(args.speaker ?? '').trim().slice(0, 200).toLowerCase()
      const docs = getDocuments().filter(d => d.speaker === speaker)
      return ok(docs.map(d => ({ id: d.id, filename: d.filename, tags: d.tags })))
    }

    // ─── Graph Analysis ───
    case 'graph_stats': {
      const nodes = getNodes()
      const links = getLinks()
      const clusters = detectClusters()
      return ok({ nodeCount: nodes.length, linkCount: links.length, clusterCount: clusters.length, isolatedNodes: nodes.length - clusters.reduce((s, c) => s + c.docIds.length, 0) })
    }
    case 'graph_pagerank': {
      return ok(computePageRank((args.topK as number) ?? 20))
    }
    case 'graph_clusters': {
      return ok(detectClusters())
    }
    case 'graph_bridges': {
      return ok(findBridgeNodes((args.topK as number) ?? 10))
    }
    case 'graph_implicit_links': {
      return ok(findImplicitLinks((args.minScore as number) ?? 0.15, (args.topK as number) ?? 30))
    }
    case 'graph_neighbors': {
      const docId = args.docId as string
      const links = getLinks()
      const neighbors = new Set<string>()
      for (const l of links) {
        if (l.source === docId) neighbors.add(l.target)
        if (l.target === docId) neighbors.add(l.source)
      }
      const docs = getDocuments()
      const idToFilename = new Map(docs.map(d => [d.id, d.filename]))
      return ok([...neighbors].map(id => ({ docId: id, filename: idToFilename.get(id) ?? id })))
    }

    // ─── Chat / LLM ───
    case 'chat': {
      const modelId = args.model as string
      const system = (args.system as string) ?? 'You are a helpful assistant.'
      const messages = args.messages as { role: string; content: string }[]
      const result = await chat(modelId, system, messages, 'mcp_chat')
      return ok({ response: result })
    }
    case 'chat_persona': {
      const persona = args.persona as string
      const message = args.message as string
      const history = (args.history as { role: string; content: string }[]) ?? []
      const useRag = (args.useRag as boolean) ?? true

      let ragContext: string | undefined
      if (useRag) {
        const results = await hybridSearch(message, 10)
        if (results.length > 0) {
          const docs = getDocuments()
          const docMap = new Map(docs.map(d => [d.id, d]))
          const contextParts: string[] = []
          for (const r of results) {
            const doc = docMap.get(r.docId)
            if (doc) contextParts.push(`### ${doc.filename}\n${doc.rawContent.slice(0, 2000)}`)
          }
          ragContext = contextParts.join('\n\n---\n\n')
        }
      }

      const result = await chatWithPersona(persona, message, history, ragContext)
      return ok({ response: result })
    }

    // ─── Edit Agent ───
    case 'edit_agent_refine': {
      const abs = safeVaultPath(args.path as string)
      if (!abs) return err('Invalid path or vault not configured')
      const content = readFile(abs)
      if (content === null) return err(`File not found: ${args.path}`)

      const modelId = (args.model as string) ?? config.editAgent.modelId
      const instructions = args.instructions as string
      const systemPrompt = `당신은 문서 편집 에이전트입니다. 사용자의 지시에 따라 문서를 수정합니다.
지시사항을 정확히 따르고, 수정된 전체 문서를 반환하세요. 마크다운 형식을 유지하세요.
${config.editAgent.refinementManual ? `\n편집 매뉴얼:\n${config.editAgent.refinementManual}` : ''}`

      const result = await chat(modelId, systemPrompt, [
        { role: 'user', content: `## 원본 문서\n\n${content}\n\n## 편집 지시\n\n${instructions}\n\n수정된 전체 문서를 반환하세요.` },
      ], 'mcp_editAgent')

      saveFile(abs, result)
      return ok({ path: args.path, message: 'Document refined and saved', preview: result.slice(0, 500) })
    }

    // ─── Debate ───
    case 'debate_start': {
      const topic = args.topic as string
      const personas = (args.personas as string[]) ?? ['chief_director', 'plan_director', 'prog_director']
      const rounds = (args.rounds as number) ?? 3

      const transcript: { round: number; persona: string; message: string }[] = []
      let history: { role: string; content: string }[] = []

      for (let round = 1; round <= rounds; round++) {
        for (const persona of personas) {
          const prompt = round === 1 && history.length === 0
            ? `주제: "${topic}"\n\n이 주제에 대해 당신의 관점에서 의견을 제시하세요. 2-3문단으로 답변하세요.`
            : `주제: "${topic}"\n\n이전 토론 내용을 참고하여 당신의 관점에서 추가 의견이나 반론을 제시하세요. 2-3문단으로 답변하세요.`

          const response = await chatWithPersona(persona, prompt, history)
          transcript.push({ round, persona, message: response })
          history.push({ role: 'assistant', content: `[${persona}] ${response}` })
          history.push({ role: 'user', content: '다음 참가자의 의견을 들어보겠습니다.' })
        }
      }

      return ok({ topic, rounds, participants: personas, transcript })
    }

    // ─── Jira Crosslink ───
    case 'jira_crosslink': {
      const dryRun = args.dry_run !== false  // default true
      const scriptPath = join(resolve(process.cwd(), '..', 'tools'), 'crosslink_jira.py')
      const scriptArgs = [scriptPath, vaultPath || '.', dryRun ? '--dry-run' : '--apply']
      const { execFile } = await import('child_process')
      return new Promise((res) => {
        execFile('python', scriptArgs, { timeout: 120000 },
          (error, stdout, stderr) => {
            if (error) res(err(`Crosslink error: ${error.message}\n${stderr}`))
            else res(ok({ stdout: stdout.trim(), stderr: stderr.trim(), applied: !dryRun }))
          })
      })
    }

    // ─── Python Tools ───
    case 'python_run': {
      const script = args.script as string
      // Prevent path traversal
      if (script.includes('..') || script.includes('/') || script.includes('\\')) {
        return err('Invalid script name — must be a filename only')
      }
      const scriptPath = join(resolve(process.cwd(), '..', 'tools'), script)
      const scriptArgs = (args.args as string[]) ?? []

      const { execFile } = await import('child_process')
      return new Promise((res) => {
        execFile('python', [scriptPath, ...scriptArgs], { timeout: 120000, cwd: vaultPath || undefined },
          (error, stdout, stderr) => {
            if (error) res(err(`Python error: ${error.message}\n${stderr}`))
            else res(ok({ stdout: stdout.trim(), stderr: stderr.trim() }))
          })
      })
    }

    // ─── Confluence Sync ───
    case 'confluence_sync': {
      const cfg = config.confluence
      if (!cfg.baseUrl || !cfg.apiToken) return err('Confluence not configured')
      const spaceKey = (args.spaceKey as string) ?? cfg.spaceKey
      const dateFrom = (args.dateFrom as string) ?? cfg.dateFrom

      const authHeader = cfg.authType === 'cloud'
        ? 'Basic ' + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64')
        : `Bearer ${cfg.apiToken}`

      const fetchOpts: RequestInit & { dispatcher?: unknown } = {
        headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(EXT_TIMEOUT_MS),
      }

      // Fetch all pages with pagination
      const targetDir = join(vaultPath, cfg.targetFolder || 'active')
      if (!(await import('fs')).existsSync(targetDir)) createFolder(targetDir)

      type ConfPage = { title: string; body: { storage: { value: string } }; version: { when: string } }
      const PAGE_LIMIT = 100
      let start = 0, synced = 0, hasMore = true

      while (hasMore) {
        const url = `${cfg.baseUrl}/rest/api/content?spaceKey=${spaceKey}&expand=body.storage,version&limit=${PAGE_LIMIT}&start=${start}&orderby=lastModified desc`
        const res = await fetch(url, fetchOpts)
        if (!res.ok) return err(`Confluence ${res.status}: ${await res.text()}`)
        const data = await res.json() as { results: ConfPage[]; size: number }
        const pages = data.results ?? []

        for (const page of pages) {
          if (dateFrom && page.version.when < dateFrom) { hasMore = false; break }
          const filename = page.title.replace(/[<>:"/\\|?*]/g, '_') + '.md'
          const content = `---\nsource: confluence\ntitle: "${page.title}"\ndate: "${page.version.when.slice(0, 10)}"\n---\n\n# ${page.title}\n\n${page.body.storage.value.replace(/<[^>]+>/g, '')}`
          saveFile(join(targetDir, filename), content)
          synced++
        }

        if (pages.length < PAGE_LIMIT) hasMore = false
        else start += PAGE_LIMIT
      }

      return ok({ synced, targetFolder: cfg.targetFolder })
    }

    // ─── Jira Sync ───
    case 'jira_sync': {
      const cfg = config.jira
      if (!cfg.baseUrl || !cfg.apiToken) return err('Jira not configured')
      const projectKey = (args.projectKey as string) ?? cfg.projectKey
      const jql = (args.jql as string) ?? cfg.jql ?? `project = ${projectKey} ORDER BY updated DESC`

      const authHeader = cfg.authType === 'cloud'
        ? 'Basic ' + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64')
        : `Bearer ${cfg.apiToken}`

      const jiraHeaders = { 'Authorization': authHeader, 'Accept': 'application/json' }
      const targetDir = join(vaultPath, cfg.targetFolder || 'jira')
      if (!(await import('fs')).existsSync(targetDir)) createFolder(targetDir)

      type JiraIssue = { key: string; fields: { summary: string; description: string | null; status: { name: string }; assignee: { displayName: string } | null; updated: string } }
      const MAX_RESULTS = 100
      let startAt = 0, synced = 0, total = Infinity

      while (startAt < total) {
        const url = `${cfg.baseUrl}/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=${MAX_RESULTS}&startAt=${startAt}&fields=summary,description,status,assignee,updated`
        const res = await fetch(url, { headers: jiraHeaders, signal: AbortSignal.timeout(EXT_TIMEOUT_MS) })
        if (!res.ok) return err(`Jira ${res.status}: ${await res.text()}`)
        const data = await res.json() as { issues: JiraIssue[]; total: number }
        total = data.total ?? 0

        for (const issue of data.issues ?? []) {
          const f = issue.fields
          const filename = `${issue.key}.md`
          const content = `---\nsource: jira\ntitle: "${f.summary}"\ndate: "${f.updated.slice(0, 10)}"\nstatus: "${f.status.name}"\n---\n\n# ${issue.key}: ${f.summary}\n\n**Status:** ${f.status.name}\n**Assignee:** ${f.assignee?.displayName ?? 'Unassigned'}\n\n${f.description ?? ''}`
          saveFile(join(targetDir, filename), content)
          synced++
        }

        startAt += data.issues?.length ?? MAX_RESULTS
        if (!data.issues?.length) break
      }

      return ok({ synced, total, targetFolder: cfg.targetFolder })
    }

    // ─── Jira Create Issue ───
    case 'jira_create_issue': {
      const cfg = config.jira
      if (!cfg.baseUrl || !cfg.apiToken) return err('Jira not configured')
      const projectKey = cfg.projectKey
      if (!projectKey) return err('Jira projectKey not configured')

      const jiraBase = cfg.baseUrl.replace(/\/$/, '')
      const isCloud = cfg.authType === 'cloud'
      const restBase = isCloud ? `${jiraBase}/rest/api/3` : `${jiraBase}/rest/api/2`
      const authHeader = cfg.authType === 'server_pat'
        ? `Bearer ${cfg.apiToken}`
        : 'Basic ' + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64')

      const summary = args.summary as string
      const description = (args.description as string) ?? ''
      const issuetype = args.issuetype as string | undefined
      const priority = args.priority as string | undefined
      const labels = (args.labels as string[]) ?? []
      const assigneeAccountId = args.assigneeAccountId as string | undefined
      const components = (args.components as string[] | undefined) ?? []
      const parentKey = args.parentKey as string | undefined

      const fields: Record<string, unknown> = {
        project: { key: projectKey },
        summary,
        labels,
      }
      // issuetype: prefer id (numeric string) over name for Server/DC compatibility
      if (issuetype) fields.issuetype = /^\d+$/.test(issuetype) ? { id: issuetype } : { name: issuetype }
      if (priority) fields.priority = { name: priority }
      if (components.length > 0) fields.components = components.map(c => ({ name: c }))
      // Cloud(v3): ADF description + accountId assignee / Server(v2): plain text + name assignee
      if (isCloud) {
        fields.description = { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] }
        if (assigneeAccountId) fields.assignee = { accountId: assigneeAccountId }
      } else {
        fields.description = description
        if (assigneeAccountId) fields.assignee = { name: assigneeAccountId }
      }
      if (parentKey) fields.parent = { key: parentKey }

      const authHeaders = { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' }
      const res = await fetch(`${restBase}/issue`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ fields }),
        signal: AbortSignal.timeout(EXT_TIMEOUT_MS),
      })
      if (!res.ok) return err(`Jira ${res.status}: ${await res.text()}`)
      const data = await res.json() as { id: string; key: string }
      const issueKey = data.key

      // ── 활성 스프린트 자동 배정 ───────────────────────────────────────────
      let sprintId: number | null = null
      try {
        const agileBase = `${jiraBase}/rest/agile/1.0`
        // 설정에 boardId가 있으면 바로 사용, 없으면 scrum 보드 자동 탐색
        let boardId: number | undefined = (cfg as Record<string, unknown>).boardId as number | undefined
        if (!boardId) {
          const boardRes = await fetch(`${agileBase}/board?projectKeyOrId=${encodeURIComponent(projectKey)}&type=scrum&maxResults=10`, { headers: authHeaders, signal: AbortSignal.timeout(EXT_TIMEOUT_MS) })
          if (boardRes.ok) {
            const boardData = await boardRes.json() as { values?: { id: number }[] }
            boardId = boardData?.values?.[0]?.id
          }
        }
        if (boardId) {
          const sprintRes = await fetch(`${agileBase}/board/${boardId}/sprint?state=active&maxResults=1`, { headers: authHeaders, signal: AbortSignal.timeout(EXT_TIMEOUT_MS) })
          if (sprintRes.ok) {
            const sprintData = await sprintRes.json() as { values?: { id: number }[] }
            sprintId = sprintData?.values?.[0]?.id ?? null
          }
        }
      } catch { /* 스프린트 조회 실패 시 백로그 유지 */ }

      if (sprintId) {
        try {
          await fetch(`${jiraBase}/rest/agile/1.0/sprint/${sprintId}/issue`, {
            method: 'POST', headers: authHeaders, body: JSON.stringify({ issues: [issueKey] }),
            signal: AbortSignal.timeout(EXT_TIMEOUT_MS),
          })
        } catch { /* 스프린트 배정 실패 시 무시 */ }
      }

      return ok({ created: true, key: issueKey, id: data.id, url: `${jiraBase}/browse/${issueKey}`, sprintId })
    }

    // ─── Jira Sprint Move ───
    case 'jira_sprint_move': {
      const cfg = config.jira
      if (!cfg.baseUrl || !cfg.apiToken) return err('Jira not configured')
      const issueKey = args.issue_key as string
      if (!issueKey) return err('issue_key is required')

      const jiraBase = cfg.baseUrl.replace(/\/$/, '')
      const authHeader = cfg.authType === 'server_pat'
        ? `Bearer ${cfg.apiToken}`
        : 'Basic ' + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64')
      const authHeaders = { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' }
      const agileBase = `${jiraBase}/rest/agile/1.0`

      let sprintId = args.sprint_id as number | undefined
      if (!sprintId) {
        // 활성 스프린트 자동 탐색
        const boardId = (cfg as Record<string, unknown>).boardId as number | undefined
        let resolvedBoardId = boardId
        if (!resolvedBoardId) {
          const boardRes = await fetch(`${agileBase}/board?projectKeyOrId=${encodeURIComponent(cfg.projectKey)}&type=scrum&maxResults=10`, { headers: authHeaders, signal: AbortSignal.timeout(EXT_TIMEOUT_MS) })
          if (boardRes.ok) {
            const bd = await boardRes.json() as { values?: { id: number }[] }
            resolvedBoardId = bd?.values?.[0]?.id
          }
        }
        if (resolvedBoardId) {
          const sprintRes = await fetch(`${agileBase}/board/${resolvedBoardId}/sprint?state=active&maxResults=1`, { headers: authHeaders, signal: AbortSignal.timeout(EXT_TIMEOUT_MS) })
          if (sprintRes.ok) {
            const sd = await sprintRes.json() as { values?: { id: number; name: string }[] }
            sprintId = sd?.values?.[0]?.id
          }
        }
      }
      if (!sprintId) return err('활성 스프린트를 찾을 수 없습니다')

      const res = await fetch(`${agileBase}/sprint/${sprintId}/issue`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ issues: [issueKey] }),
      })
      if (!res.ok && res.status !== 204) return err(`Sprint move failed: ${res.status} ${await res.text()}`)
      return ok({ moved: true, issueKey, sprintId })
    }

    // ─── Jira Get Members ───
    case 'jira_get_members': {
      const cfg = config.jira
      if (!cfg.baseUrl || !cfg.apiToken) return err('Jira not configured')
      const projectKey = (args.projectKey as string) ?? cfg.projectKey
      if (!projectKey) return err('Jira projectKey not configured')

      const jiraBase = cfg.baseUrl.replace(/\/$/, '')
      const isCloud = cfg.authType === 'cloud'
      const restBase = isCloud ? `${jiraBase}/rest/api/3` : `${jiraBase}/rest/api/2`
      const authHeader = cfg.authType === 'server_pat'
        ? `Bearer ${cfg.apiToken}`
        : 'Basic ' + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64')

      const url = `${restBase}/user/assignable/search?project=${encodeURIComponent(projectKey)}&maxResults=50`
      const res = await fetch(url, { headers: { 'Authorization': authHeader, 'Accept': 'application/json' } })
      if (!res.ok) return err(`Jira ${res.status}: ${await res.text()}`)
      // Cloud: accountId field / Server: name field (login username)
      const data = await res.json() as { accountId?: string; name?: string; displayName: string; emailAddress?: string }[]
      const members = data.map(u => ({ accountId: u.accountId ?? u.name ?? '', displayName: u.displayName, email: u.emailAddress ?? '' }))

      const configured = config.teamMembers ?? []
      return ok({ members, configuredTeamMembers: configured })
    }

    // ─── Jira Transition ───
    case 'jira_transition': {
      const cfg = config.jira
      if (!cfg.baseUrl || !cfg.apiToken) return err('Jira not configured')
      const issueKey = args.issue_key as string
      if (!issueKey) return err('issue_key is required')
      const transitionName = args.transition_name as string | undefined
      const listOnly = Boolean(args.list_only)

      const jiraBase = cfg.baseUrl.replace(/\/$/, '')
      const restBase = cfg.authType === 'cloud' ? `${jiraBase}/rest/api/3` : `${jiraBase}/rest/api/2`
      const authHeader = cfg.authType === 'server_pat'
        ? `Bearer ${cfg.apiToken}`
        : 'Basic ' + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64')
      const authHeaders = { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' }

      // 전환 목록 조회
      const listRes = await fetch(`${restBase}/issue/${issueKey}/transitions`, { headers: authHeaders, signal: AbortSignal.timeout(EXT_TIMEOUT_MS) })
      if (!listRes.ok) return err(`Jira ${listRes.status}: ${await listRes.text()}`)
      const listData = await listRes.json() as { transitions: { id: string; name: string; to: { name: string } }[] }
      const transitions = listData.transitions ?? []

      if (listOnly || !transitionName) {
        return ok({ transitions: transitions.map(t => ({ id: t.id, name: t.name, to: t.to.name })) })
      }

      // 이름 매칭 (대소문자 무시)
      const target = transitions.find(t => t.name.toLowerCase() === transitionName.toLowerCase())
      if (!target) {
        return err(`전환 "${transitionName}"을 찾을 수 없습니다. 가능한 전환: ${transitions.map(t => t.name).join(', ')}`)
      }

      const transRes = await fetch(`${restBase}/issue/${issueKey}/transitions`, {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ transition: { id: target.id } }),
        signal: AbortSignal.timeout(EXT_TIMEOUT_MS),
      })
      if (!transRes.ok && transRes.status !== 204) return err(`Transition failed: ${transRes.status} ${await transRes.text()}`)
      return ok({ transitioned: true, issueKey, from: transitionName, to: target.to.name })
    }

    // ─── Confluence Write Page ───
    case 'confluence_write_page': {
      const cfg = config.confluence
      if (!cfg.baseUrl || !cfg.apiToken) return err('Confluence not configured')
      const mode = (args.mode as string) ?? 'create'
      const title = args.title as string
      const markdownContent = args.markdownContent as string

      const authHeader = cfg.authType === 'server_pat'
        ? `Bearer ${cfg.apiToken}`
        : 'Basic ' + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64')
      const headers = { 'Authorization': authHeader, 'Accept': 'application/json', 'Content-Type': 'application/json' }

      // SSL bypass fetch helper
      const cfFetch = (url: string, opts: { method?: string; headers: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }> => {
        if (!cfg.bypassSSL) return fetch(url, { ...opts, signal: AbortSignal.timeout(EXT_TIMEOUT_MS) }) as ReturnType<typeof cfFetch>
        return new Promise((resolve, reject) => {
          const parsed = new URL(url)
          const lib = parsed.protocol === 'https:' ? https : http
          const req = lib.request(url, {
            method: opts.method ?? 'GET',
            headers: opts.headers,
            rejectUnauthorized: false,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            secureOptions: (crypto.constants as any).SSL_OP_LEGACY_SERVER_CONNECT,
          }, (res) => {
            const chunks: Buffer[] = []
            res.on('data', (c: Buffer) => chunks.push(c))
            res.on('end', () => {
              const raw = Buffer.concat(chunks).toString('utf-8')
              resolve({
                ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
                status: res.statusCode ?? 0,
                text: async () => raw,
                json: async () => JSON.parse(raw),
              })
            })
          })
          req.on('error', reject)
          req.setTimeout(EXT_TIMEOUT_MS, () => { req.destroy(new Error('timeout')) })
          if (opts.body) req.write(opts.body)
          req.end()
        })
      }
      const fetchOpts = (body?: string) => ({
        headers,
        ...(body !== undefined ? { body } : {}),
      })

      // Simple Markdown → Confluence storage converter
      function mdToStorage(md: string): string {
        const codeBlocks: string[] = []
        let s = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang: string, code: string) => {
          const idx = codeBlocks.length
          codeBlocks.push(`<ac:structured-macro ac:name="code">${lang ? `<ac:parameter ac:name="language">${lang}</ac:parameter>` : ''}<ac:plain-text-body><![CDATA[${code.trim()}]]></ac:plain-text-body></ac:structured-macro>`)
          return `\x00CODE${idx}\x00`
        })
        s = s.replace(/^#### (.+)$/gm, '<h4>$1</h4>').replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>')
        s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`([^`]+)`/g, '<code>$1</code>')
        s = s.replace(/((?:^[ \t]*[-*] .+\n?)+)/gm, (b: string) => `<ul>${b.trim().split('\n').map((l: string) => `<li>${l.replace(/^[ \t]*[-*] /, '')}</li>`).join('')}</ul>\n`)
        const parts = s.split(/\n{2,}/).map((b: string) => {
          const t = b.trim(); if (!t) return ''
          if (t.startsWith('<') || t.startsWith('\x00CODE')) return t
          return `<p>${t.replace(/\n/g, '<br />')}</p>`
        }).filter(Boolean)
        let result = parts.join('\n')
        codeBlocks.forEach((code: string, i: number) => { result = result.replace(`\x00CODE${i}\x00`, code) })
        return result
      }

      const storageBody = mdToStorage(markdownContent)

      if (mode === 'update') {
        const pageId = args.pageId as string
        if (!pageId) return err('pageId required for update mode')
        // Fetch current version
        const infoRes = await cfFetch(`${cfg.baseUrl}/rest/api/content/${pageId}?expand=version`, fetchOpts())
        if (!infoRes.ok) return err(`Confluence ${infoRes.status}: ${await infoRes.text()}`)
        const info = await infoRes.json() as { version: { number: number }; space: { key: string } }
        const newVersion = (info.version?.number ?? 1) + 1
        const putBody = JSON.stringify({ version: { number: newVersion }, title, type: 'page', body: { storage: { value: storageBody, representation: 'storage' } } })
        const res = await cfFetch(`${cfg.baseUrl}/rest/api/content/${pageId}`, { method: 'PUT', ...fetchOpts(putBody) })
        if (!res.ok) return err(`Confluence ${res.status}: ${await res.text()}`)
        const data = await res.json() as { id: string; _links?: { webui?: string } }
        return ok({ id: data.id, url: `${cfg.baseUrl}${data._links?.webui ?? ''}`, mode: 'updated' })
      } else {
        const spaceKey = (args.spaceKey as string) || cfg.spaceKey
        if (!spaceKey) return err('spaceKey required for create mode')
        const ancestors = args.parentId ? [{ id: args.parentId as string }] : []
        const postBody = JSON.stringify({ type: 'page', title, space: { key: spaceKey }, ancestors, body: { storage: { value: storageBody, representation: 'storage' } } })
        const res = await cfFetch(`${cfg.baseUrl}/rest/api/content`, { method: 'POST', ...fetchOpts(postBody) })
        if (!res.ok) return err(`Confluence ${res.status}: ${await res.text()}`)
        const data = await res.json() as { id: string; _links?: { webui?: string } }
        return ok({ id: data.id, url: `${cfg.baseUrl}${data._links?.webui ?? ''}`, mode: 'created' })
      }
    }

    // ─── Slack ───
    case 'slack_send': {
      const cfg = config.slackBot
      if (!cfg.botToken) return err('Slack bot not configured')
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.botToken}` },
        body: JSON.stringify({ channel: args.channel, text: args.text }),
      })
      const data = await res.json() as { ok: boolean; error?: string; ts?: string }
      if (!data.ok) return err(`Slack error: ${data.error}`)
      return ok({ sent: true, ts: data.ts })
    }

    // ─── Usage Tracking ───
    case 'usage_summary': {
      return ok(getUsageSummary())
    }
    case 'usage_log': {
      return ok(getUsageLog((args.limit as number) ?? 100))
    }

    // ─── Settings ───
    case 'settings_get': {
      const cfg = { ...getConfig() }
      // Mask API keys for security
      const masked: Record<string, string> = {}
      for (const [k, v] of Object.entries(cfg.apiKeys)) {
        masked[k] = v ? `${v.slice(0, 8)}...${v.slice(-4)}` : '(not set)'
      }
      return ok({ ...cfg, apiKeys: masked })
    }
    case 'settings_update': {
      const updates = args.updates as Record<string, unknown>
      updateConfig(updates)
      return ok({ message: 'Settings updated', updatedKeys: Object.keys(updates) })
    }

    default:
      return err(`Unknown tool: ${name}`)
  }
}

// ── MCP Gate Prompt ─────────────────────────────────────────────────────────
// Injected when Claude Code connects — tells the model it's in MCP control mode.

const GATE_PROMPT = `당신은 지금 **Strata Sync MCP 서버**에 연결되어 있습니다.

## 모드: MCP 풀 컨트롤
- GUI의 API 키를 사용하지 않습니다. 모든 LLM 호출은 이 MCP 서버를 경유합니다.
- 당신은 서브 에이전트를 통해 Strata Sync의 모든 기능을 직접 통제합니다.
- vault CRUD, 그래프 분석, 채팅, 검색, Edit Agent, 토론, Python 도구,
  Confluence/Jira 동기화, Slack 봇, 사용량 추적, 설정 — 전부 MCP 도구로 제어 가능합니다.

## 사용 가능한 도구 (32개)
| 카테고리 | 도구 |
|---------|------|
| Vault CRUD | vault_reload, vault_list, vault_read, vault_write, vault_delete, vault_rename, vault_move, vault_mkdir |
| 검색 | search_bm25, search_tags, search_speaker |
| 그래프 분석 | graph_stats, graph_pagerank, graph_clusters, graph_bridges, graph_implicit_links, graph_neighbors |
| 채팅 / LLM | chat, chat_persona |
| 편집 에이전트 | edit_agent_refine |
| 토론 | debate_start |
| Python 도구 | python_run |
| 외부 연동 | confluence_sync, confluence_write_page, jira_sync, jira_create_issue, jira_get_members, slack_send |
| 사용량 | usage_summary, usage_log |
| 설정 | settings_get, settings_update |

## 핵심 원칙
1. **vault_reload를 먼저 호출** — 검색/그래프 도구 사용 전에 볼트를 로드하세요.
2. **search_bm25로 컨텍스트 수집** → chat_persona로 페르소나 채팅 — RAG 파이프라인.
3. **edit_agent_refine**으로 문서 자동 정제 — 지시사항만 주면 LLM이 수정 후 저장.
4. **graph_stats → graph_pagerank → graph_clusters** — 볼트 구조 파악 순서.
5. 비용 추적: usage_summary로 현재 세션 토큰/비용 확인.

이 프롬프트는 MCP 게이트를 통과할 때 자동 주입됩니다.`

// ── Create server ───────────────────────────────────────────────────────────

export function createServer(): Server {
  const server = new Server(
    { name: 'strata-sync', version: '0.3.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  )

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    try {
      return await handleTool(name, (args ?? {}) as Args)
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  })

  // List resources (vault docs as MCP resources)
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const docs = getDocuments()
    return {
      resources: docs.slice(0, 200).map(d => ({
        uri: `vault://${d.id}`,
        name: d.filename,
        mimeType: 'text/markdown',
        description: `Speaker: ${d.speaker}, Tags: ${d.tags.join(', ')}`,
      })),
    }
  })

  // Read resource
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri
    const docId = uri.replace('vault://', '')
    const doc = getDocuments().find(d => d.id === docId)
    if (!doc) throw new Error(`Document not found: ${docId}`)
    return { contents: [{ uri, mimeType: 'text/markdown', text: doc.rawContent }] }
  })

  // List prompts — exposes the gate prompt
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{
      name: 'strata-sync-gate',
      description: 'Strata Sync MCP 풀 컨트롤 모드 — 연결 시 자동 주입되는 시스템 프롬프트',
    }],
  }))

  // Get prompt — returns the gate prompt content
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    if (req.params.name !== 'strata-sync-gate') {
      throw new Error(`Unknown prompt: ${req.params.name}`)
    }
    return {
      description: 'Strata Sync MCP 풀 컨트롤 모드',
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: GATE_PROMPT } }],
    }
  })

  return server
}
