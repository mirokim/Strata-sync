import { useEffect, useRef } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useVaultLoader } from '@/hooks/useVaultLoader'
import { usePersonaVaultSaver } from '@/hooks/usePersonaVaultSaver'
import { useRagApi } from '@/hooks/useRagApi'
import LaunchPage from '@/components/launch/LaunchPage'
import MainLayout from '@/components/layout/MainLayout'
import LoadingOverlay from '@/components/layout/LoadingOverlay'

export default function App() {
  const { appState, theme, panelOpacity, setAppState } = useUIStore()
  const { vaultPath, loadVault } = useVaultLoader()
  usePersonaVaultSaver()
  useRagApi()
  const vaultLoaded = useRef(false)

  // Apply theme to document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Sync panel opacity CSS variable so all panels update instantly
  useEffect(() => {
    document.documentElement.style.setProperty('--panel-opacity', panelOpacity.toString())
  }, [panelOpacity])

  // Auto-load persisted vault on app startup
  useEffect(() => {
    if (vaultLoaded.current || !vaultPath) return
    vaultLoaded.current = true
    loadVault(vaultPath).then(() => {
      window.vaultAPI?.watchStart(vaultPath)
    })
  }, [vaultPath, loadVault])

  return (
    <>
      {appState === 'launch'
        ? <LaunchPage onComplete={() => setAppState('main')} />
        : <MainLayout />}
      <LoadingOverlay />
    </>
  )
}
