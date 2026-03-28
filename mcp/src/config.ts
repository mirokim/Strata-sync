/**
 * MCP Config — reads mcp-config.json for API keys, vault path, and settings.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'

export interface TeamMember {
  name: string
  jiraAccountId: string
  role: string
  responsibilities: string[]
}

export interface McpConfig {
  vaultPath: string
  apiKeys: Record<string, string>
  personaModels: Record<string, string>
  projectInfo: {
    name: string
    engine: string
    genre: string
    platform: string
    description: string
    rawProjectInfo: string
    currentSituation: string
  }
  editAgent: {
    modelId: string
    refinementManual: string
  }
  confluence: {
    baseUrl: string
    authType: string
    email: string
    apiToken: string
    spaceKey: string
    targetFolder: string
    dateFrom: string
    bypassSSL: boolean
  }
  jira: {
    baseUrl: string
    email: string
    apiToken: string
    projectKey: string
    jql: string
    authType: string
    bypassSSL: boolean
    targetFolder: string
  }
  slackBot: {
    botToken: string
    appToken: string
    signingSecret: string
    model: string
  }
  searchConfig: {
    filenameWeight: number
    bodyWeight: number
    bm25Candidates: number
    bfsMaxHops: number
    bfsMaxDocs: number
    fullVaultThreshold: number
  }
  responseInstructions: string
  ragInstruction: string
  sensitiveKeywords: string
  teamMembers: TeamMember[]
}

const DEFAULTS: McpConfig = {
  vaultPath: '',
  apiKeys: {},
  personaModels: {
    chief_director: 'claude-sonnet-4-6',
    art_director: 'claude-sonnet-4-6',
    plan_director: 'claude-sonnet-4-6',
    level_director: 'claude-sonnet-4-6',
    prog_director: 'claude-sonnet-4-6',
  },
  projectInfo: { name: '', engine: '', genre: '', platform: '', description: '', rawProjectInfo: '', currentSituation: '' },
  editAgent: { modelId: 'claude-sonnet-4-6', refinementManual: '' },
  confluence: { baseUrl: '', authType: 'cloud', email: '', apiToken: '', spaceKey: '', targetFolder: 'active', dateFrom: '2026-01-01', bypassSSL: false },
  jira: { baseUrl: '', email: '', apiToken: '', projectKey: '', jql: '', authType: 'cloud', bypassSSL: false, targetFolder: 'jira' },
  slackBot: { botToken: '', appToken: '', signingSecret: '', model: 'claude-sonnet-4-6' },
  searchConfig: { filenameWeight: 10, bodyWeight: 1, bm25Candidates: 8, bfsMaxHops: 3, bfsMaxDocs: 20, fullVaultThreshold: 60000 },
  responseInstructions: '',
  ragInstruction: '',
  sensitiveKeywords: '',
  teamMembers: [],
}

let _config: McpConfig | null = null
let _configPath: string = ''

export function getConfigPath(): string {
  if (_configPath) return _configPath
  const envPath = process.env.STRATA_SYNC_CONFIG
  if (envPath) return resolve(envPath)
  return resolve(process.cwd(), 'mcp-config.json')
}

export function loadConfig(): McpConfig {
  const path = getConfigPath()
  _configPath = path
  if (!existsSync(path)) {
    // Create default config
    writeFileSync(path, JSON.stringify(DEFAULTS, null, 2), 'utf-8')
    _config = { ...DEFAULTS }
    return _config
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    _config = { ...DEFAULTS, ...JSON.parse(raw) }
    return _config!
  } catch {
    _config = { ...DEFAULTS }
    return _config
  }
}

export function getConfig(): McpConfig {
  if (!_config) return loadConfig()
  return _config
}

export function updateConfig(updates: Partial<McpConfig>): void {
  _config = { ...getConfig(), ...updates }
  writeFileSync(_configPath || getConfigPath(), JSON.stringify(_config, null, 2), 'utf-8')
}

export function getApiKey(provider: string): string {
  return getConfig().apiKeys[provider] ?? ''
}
