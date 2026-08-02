import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught render error', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 16, padding: 24, background: '#0a0a0f', color: '#e4e4e7',
          fontFamily: 'monospace', textAlign: 'center',
        }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>Something went wrong</h1>
          <pre style={{ fontSize: 13, color: '#f87171', maxWidth: 720, whiteSpace: 'pre-wrap', textAlign: 'left' }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #3f3f46', background: '#18181b', color: '#e4e4e7', cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
