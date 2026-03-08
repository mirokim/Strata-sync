import { useEffect, useRef, useState } from 'react'
import { useUIStore } from '@/stores/uiStore'

const MEASURE_WINDOW_MS = 500

/**
 * Measures requestAnimationFrame FPS over a 500ms sliding window.
 * Returns the current FPS as a number.
 *
 * NOTE: Auto-switching to 2D based on low FPS is intentionally disabled —
 * the user controls the graph mode manually via the 2D/3D toggle button.
 * The hook remains in place for future FPS monitoring / debugging purposes.
 */
export function useFrameRate(): number {
  const { graphMode } = useUIStore()
  const [fps, setFps] = useState(60)
  const rafId = useRef(0)
  const frameCount = useRef(0)
  const windowStart = useRef(0)

  useEffect(() => {
    if (graphMode !== '3d') return
    frameCount.current = 0
    windowStart.current = performance.now()

    const tick = (now: number) => {
      frameCount.current++
      const elapsed = now - windowStart.current

      if (elapsed >= MEASURE_WINDOW_MS) {
        const avgFps = (frameCount.current / elapsed) * 1000
        setFps(avgFps)
        // Reset window
        windowStart.current = now
        frameCount.current = 0
      }

      rafId.current = requestAnimationFrame(tick)
    }

    rafId.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId.current)
  }, [graphMode])

  return fps
}
