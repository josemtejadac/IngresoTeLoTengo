import { Component, type ReactNode } from 'react'

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

  render() {
    if (this.state.error) {
      return (
        <div className="page-center">
          <p className="error-text">Ocurrió un error: {this.state.error.message}</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Volver a cargar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
