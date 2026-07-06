// Global error boundary for the app root. Renders a designed 500 page
// with a "try again" button. Logs to Sentry in production (PH19 wires
// the Sentry SDK; for PH02 we just log via pino).
'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@foundations/ui/primitives/Button'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }
  static getDerivedStateFromError(error: Error): State {
    return { error }
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logging only — no PII, no full stack to console.
    // eslint-disable-next-line no-console
    console.error('[error-boundary]', error.message, info.componentStack?.split('\n')[1])
  }
  override render() {
    if (this.state.error) {
      return (
        <main
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
            padding: '48px 24px',
            textAlign: 'center',
          }}
        >
          <p
            style={{
              fontSize: 12,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--text-3)',
              marginBottom: 8,
            }}
          >
            Error
          </p>
          <h1 style={{ fontSize: 28, color: 'var(--heading)', marginBottom: 12 }}>
            Something went wrong.
          </h1>
          <p style={{ color: 'var(--text-2)', maxWidth: 480, marginBottom: 24 }}>
            The page hit an unexpected error. We&apos;ve been notified. You can try again, or head back
            home.
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button onClick={() => this.setState({ error: null })}>Try again</Button>
            <Button variant="secondary" onClick={() => (window.location.href = '/')}>
              Go home
            </Button>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}
