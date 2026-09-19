import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { failed: boolean }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('application render failed', { message: error.message, componentStack: info.componentStack })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <main className="fatalError" role="alert">
      <p>Discipline+</p>
      <h1>The app hit an unexpected problem.</h1>
      <p>Your saved data has not been reset. Reload to try again.</p>
      <button type="button" onClick={() => window.location.reload()}>Reload app</button>
    </main>
  }
}
