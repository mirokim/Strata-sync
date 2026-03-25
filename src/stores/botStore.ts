import { create } from 'zustand'
import { useSettingsStore, getApiKey } from './settingsStore'
import { useVaultStore } from './vaultStore'

interface BotStore {
  running: boolean
  setRunning: (v: boolean) => void
  startBot: () => Promise<{ ok: boolean; error?: string }>
  stopBot: () => Promise<void>
}

export const useBotStore = create<BotStore>((set) => ({
  running: false,
  setRunning: (v) => set({ running: v }),

  startBot: async () => {
    const { slackBotConfig } = useSettingsStore.getState()
    const vaultPath = useVaultStore.getState().vaultPath
    const apiKey = getApiKey('anthropic') ?? ''
    const result = await window.botAPI?.start({
      vault_path:      vaultPath ?? '',
      claude_api_key:  apiKey,
      slack_bot_token: slackBotConfig.botToken,
      slack_app_token: slackBotConfig.appToken,
      slack_model:     slackBotConfig.model,
      interval_hours:  1,
      auto_run:        false,
      slack_rag_top_n: 5,
    })
    if (result?.ok) {
      set({ running: true })
      return { ok: true }
    }
    return { ok: false, error: result?.error ?? 'Unknown error' }
  },

  stopBot: async () => {
    await window.botAPI?.stop()
    set({ running: false })
  },
}))
