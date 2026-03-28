#!/usr/bin/env node
/**
 * Strata Sync MCP Server — Entry point.
 * Communicates via stdio (JSON-RPC) with Claude Code or any MCP client.
 *
 * ⚡ Fast gate: transport connects FIRST, vault loads lazily in background.
 *    Claude Code gets a working connection in < 200ms.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig } from './config.js'
import { reloadVault } from './state.js'
import { createServer } from './server.js'

async function main() {
  const t0 = Date.now()

  // 1. Load config (sync, fast — just reads a JSON file)
  const config = loadConfig()
  console.error(`[strata-sync] config loaded (${Date.now() - t0}ms)`)

  // 2. Connect transport IMMEDIATELY — Claude Code can start sending requests
  const server = createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`[strata-sync] ⚡ ready (${Date.now() - t0}ms)`)

  // 3. Lazy-load vault in background — search/graph tools work once this resolves
  if (config.vaultPath) {
    reloadVault(config.vaultPath).then(stats => {
      console.error(`[strata-sync] vault loaded: ${stats.docCount} docs, ${stats.nodeCount} nodes, ${stats.linkCount} links (${Date.now() - t0}ms)`)
    }).catch(e => {
      console.error(`[strata-sync] vault load failed:`, e)
    })
  }
}

main().catch((e) => {
  console.error('[strata-sync] fatal:', e)
  process.exit(1)
})
