import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useUIStore } from '@/stores/uiStore'

// ── Mock Framer Motion ─────────────────────────────────────────────────────
// Framer Motion's animation engine doesn't run in jsdom — replace with stubs.
vi.mock('framer-motion', () => {
  const React = require('react')
  const motion = new Proxy({}, {
    get: (_target, tag: string) => {
      return React.forwardRef(
        ({ children, animate, initial, exit, variants, custom, ...rest }: any, ref: any) =>
          React.createElement(tag, { ref, ...rest }, children)
      )
    },
  })
  return {
    motion,
    AnimatePresence: ({ children }: any) => children,
  }
})

let LaunchPage: typeof import('@/components/launch/LaunchPage').default

beforeEach(async () => {
  vi.useFakeTimers()
  useUIStore.setState({
    appState: 'launch',
    centerTab: 'graph',
    selectedDocId: null,
    theme: 'dark',
    graphMode: '2d',
  })
  const mod = await import('@/components/launch/LaunchPage')
  LaunchPage = mod.default
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('LaunchPage — basic render', () => {
  it('renders the launch page container', () => {
    render(<LaunchPage onComplete={vi.fn()} />)
    expect(screen.getByTestId('launch-page')).toBeInTheDocument()
  })

  it('renders the SVG/animation sequence', () => {
    render(<LaunchPage onComplete={vi.fn()} />)
    expect(screen.getByTestId('launch-svg')).toBeInTheDocument()
  })

  it('renders the center node element', () => {
    render(<LaunchPage onComplete={vi.fn()} />)
    expect(screen.getByTestId('launch-center-node')).toBeInTheDocument()
  })
})

describe('LaunchPage — completion', () => {
  it('calls onComplete after animation sequence finishes (~2400ms)', async () => {
    const onComplete = vi.fn()
    render(<LaunchPage onComplete={onComplete} />)

    await act(async () => { vi.advanceTimersByTime(2500) })

    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('does not call onComplete before animation finishes', async () => {
    const onComplete = vi.fn()
    render(<LaunchPage onComplete={onComplete} />)

    await act(async () => { vi.advanceTimersByTime(1000) })

    expect(onComplete).not.toHaveBeenCalled()
  })

  it('calls onComplete only once', async () => {
    const onComplete = vi.fn()
    render(<LaunchPage onComplete={onComplete} />)

    await act(async () => { vi.advanceTimersByTime(5000) })

    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})

describe('LaunchPage — graphMode routing', () => {
  it('renders SVG sequence in 2D mode', () => {
    useUIStore.setState({ ...useUIStore.getState(), graphMode: '2d' })
    render(<LaunchPage onComplete={vi.fn()} />)
    expect(screen.getByTestId('launch-svg')).toBeInTheDocument()
  })

  it('renders SVG sequence in 3D mode (same component in prototype)', () => {
    useUIStore.setState({ ...useUIStore.getState(), graphMode: '3d' })
    render(<LaunchPage onComplete={vi.fn()} />)
    expect(screen.getByTestId('launch-svg')).toBeInTheDocument()
  })
})
