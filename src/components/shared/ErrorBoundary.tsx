import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logger } from '@/lib/logger'

interface Props {
  children: ReactNode
  /** Custom fallback to display when an error occurs (default: built-in UI) */
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * ErrorBoundary — React component tree error blocker
 *
 * Catches exceptions thrown by child components to prevent full app crashes.
 * Displays a fallback UI and provides a retry button on error.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeCriticalComponent />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('[ErrorBoundary] Component error:', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: '2rem',
            gap: '1rem',
            color: 'var(--color-text-muted)',
            fontSize: '0.875rem',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '2rem' }}>⚠️</div>
          <div style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
            A rendering error occurred
          </div>
          {this.state.error && (
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                padding: '0.5rem 0.75rem',
                borderRadius: 6,
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                maxWidth: 400,
                wordBreak: 'break-word',
              }}
            >
              {this.state.error.message}
            </div>
          )}
          <button
            onClick={this.handleReset}
            style={{
              padding: '0.4rem 1rem',
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              fontSize: '0.75rem',
            }}
          >
            Retry
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
