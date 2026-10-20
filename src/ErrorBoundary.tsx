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

  componentDidCatch(error: Error) {
    // Una pestaña con la version anterior abierta pide archivos que ya no existen: se recarga sola (una vez por
    // minuto como maximo) para tomar la version nueva, en vez de dejar un error en pantalla.
    const esDeCarga = /dynamically imported module|Failed to fetch|Importing a module script failed|error loading/i.test(
      error.message,
    )
    if (!esDeCarga) return
    try {
      const ultima = Number(sessionStorage.getItem('tlt-recarga-error') ?? 0)
      if (Date.now() - ultima < 60_000) return
      sessionStorage.setItem('tlt-recarga-error', String(Date.now()))
    } catch {
      // sin almacenamiento: se intenta recargar igual
    }
    window.location.reload()
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
