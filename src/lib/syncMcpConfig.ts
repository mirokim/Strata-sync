/**
 * syncMcpConfig — GUI 설정을 mcp-config.json에 자동 동기화.
 *
 * Electron 환경에서만 동작 (configAPI 없으면 no-op).
 * JiraTab / ConfluenceTab / SlackBotTab에서 설정 변경 시 호출.
 */

import type { JiraConfig, ConfluenceConfig } from '@/stores/settingsStore'

export async function syncJiraToMcp(cfg: JiraConfig): Promise<void> {
  if (!window.configAPI) return
  await window.configAPI.writeMcp({
    jira: {
      baseUrl:     cfg.baseUrl,
      email:       cfg.email,
      apiToken:    cfg.apiToken,
      projectKey:  cfg.projectKey,
      jql:         cfg.jql,
      authType:    cfg.authType,
      bypassSSL:   cfg.bypassSSL,
      targetFolder: cfg.targetFolder,
    },
  })
}

export async function syncConfluenceToMcp(cfg: ConfluenceConfig): Promise<void> {
  if (!window.configAPI) return
  await window.configAPI.writeMcp({
    confluence: {
      baseUrl:     cfg.baseUrl,
      email:       cfg.email,
      apiToken:    cfg.apiToken,
      spaceKey:    cfg.spaceKey,
      authType:    cfg.authType,
      bypassSSL:   cfg.bypassSSL,
      targetFolder: cfg.targetFolder,
      dateFrom:    cfg.dateFrom,
    },
  })
}

export async function syncSlackToMcp(cfg: { botToken: string; appToken: string; model: string }): Promise<void> {
  if (!window.configAPI) return
  await window.configAPI.writeMcp({
    slackBot: {
      botToken:      cfg.botToken,
      appToken:      cfg.appToken,
      signingSecret: '',
      model:         cfg.model,
    },
  })
}
